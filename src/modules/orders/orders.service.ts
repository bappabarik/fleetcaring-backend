import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../../lib/errors.js";
import { TimeslotsService } from "../timeslots/timeslots.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import type { CreateOrderBody } from "./orders.schemas.js";
import { Prisma, Shipment, ShipmentStatus } from "@prisma/client";

/** Human-friendly numeric IDs matching the reference admin panel's style
 * (e.g. "14295643"). Both use the same 8-digit range (90M possibilities) —
 * generateUniqueOrderNumber/generateUniqueShipmentNumber below still check
 * for collisions explicitly and retry, since "very unlikely" isn't the
 * same as "impossible", and a raw unique-constraint violation mid-
 * transaction would abort the whole order creation (including the
 * already-booked timeslot capacity) rather than degrading gracefully. */
function generateOrderNumber(): string {
  return String(Math.floor(10_000_000 + Math.random() * 89_999_999));
}

function generateShipmentNumber(): string {
  return String(Math.floor(10_000_000 + Math.random() * 89_999_999));
}

const MAX_NUMBER_GENERATION_ATTEMPTS = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateUniqueOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < MAX_NUMBER_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateOrderNumber();
    const existing = await tx.order.findUnique({ where: { orderNumber: candidate } });
    if (!existing) return candidate;
  }
  throw new Error("Failed to generate a unique order number — this should be astronomically rare; investigate if it recurs");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateUniqueShipmentNumber(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < MAX_NUMBER_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateShipmentNumber();
    const existing = await tx.shipment.findUnique({ where: { shipmentNumber: candidate } });
    if (!existing) return candidate;
  }
  throw new Error("Failed to generate a unique shipment number — this should be astronomically rare; investigate if it recurs");
}

/**
 * NOTE: `tx: any` in the transaction callback below is deliberate — same
 * reasoning as in TimeslotsService/ShipmentsService. Tighten to
 * Prisma.TransactionClient once `prisma generate` has run for real.
 */
export class OrdersService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async createOrder(userId: string, body: CreateOrderBody) {
    const address = await this.prisma.address.findUnique({ where: { id: body.addressId } });
    if (!address) throw new NotFoundError("Address not found");
    if (address.ownerId !== userId) throw new ForbiddenError("This address does not belong to you");

    const vehicles = await this.prisma.vehicle.findMany({ where: { id: { in: body.vehicleIds } } });
    if (vehicles.length !== body.vehicleIds.length) throw new BadRequestError("One or more vehicles not found");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (vehicles.some((v) => v.ownerId !== userId)) {
      throw new ForbiddenError("One or more vehicles do not belong to you");
    }

    const itemVariation = await this.prisma.itemVariation.findUnique({ where: { id: body.itemVariationId } });
    if (!itemVariation || !itemVariation.isActive) throw new NotFoundError("Service item not found");

    const addOnVariations = body.addOnItemVariationIds.length
      ? await this.prisma.itemVariation.findMany({ where: { id: { in: body.addOnItemVariationIds } } })
      : [];
    if (addOnVariations.length !== body.addOnItemVariationIds.length) {
      throw new BadRequestError("One or more add-ons not found");
    }

    const catalogService = new CatalogService(this.app);
    const timeslotsService = new TimeslotsService(this.app);

    const basePricePerVehicle = await catalogService.resolveEffectivePrice(itemVariation.id, address.zoneId ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addOnsPricePerVehicle = addOnVariations.reduce((sum: number, v) => sum + Number(v.priceAED), 0);
    const totalAED = (basePricePerVehicle + addOnsPricePerVehicle) * vehicles.length;

    const orderId = randomUUID();

    // Everything below is one transaction: booking the timeslot's capacity
    // and creating the order + its shipments either all succeed together or
    // all roll back together. This is exactly why TimeslotsService exposes
    // bookSlotInTransaction() — a standalone bookSlot() call here would let
    // an order-creation failure leave a slot's capacity claimed with no
    // order to show for it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await timeslotsService.bookSlotInTransaction(tx, body.timeslotId, userId);

      const orderNumber = await generateUniqueOrderNumber(tx);

      await tx.order.create({
        data: {
          id: orderId,
          orderNumber,
          userId,
          addressId: body.addressId,
          timeslotId: body.timeslotId,
          totalAED,
        },
      });

      if (body.notes) {
        await tx.orderNote.create({
          data: { orderId, authorType: "customer", authorId: userId, text: body.notes },
        });
      }

      for (const vehicle of vehicles) {
        const shipmentId = randomUUID();
        const shipmentNumber = await generateUniqueShipmentNumber(tx);

        await tx.shipment.create({
          data: {
            id: shipmentId,
            shipmentNumber,
            orderId,
            vehicleId: vehicle.id,
            itemVariationId: itemVariation.id,
          },
        });

        for (const addOn of addOnVariations) {
          await tx.shipmentAddOn.create({
            data: { shipmentId, itemVariationId: addOn.id, priceAED: addOn.priceAED },
          });
        }

        await tx.shipmentStatusEvent.create({
          data: { shipmentId, status: "CREATED", actorType: "user", actorId: userId },
        });
      }

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { shipments: true, notes: true },
      });
    });
  }

  async getOrderById(id: string, requestingUserId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        shipments: { include: { checks: true, issues: true, statusHistory: true, addOns: true } },
        notes: true,
        payment: true,
      },
    });
    if (!order) throw new NotFoundError("Order not found");
    if (requestingUserId && order.userId !== requestingUserId) throw new ForbiddenError("Not your order");
    return order;
  }

  async listOrdersForUser(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: { shipments: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async listAllOrders() {
    return this.prisma.order.findMany({
      include: { shipments: true, user: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async markEnroute(orderId: string, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notAssigned = order.shipments.filter((s) => s.status !== "ASSIGNED");
    if (notAssigned.length > 0) throw new ConflictError("All items must be assigned before starting the trip");

    await this.bulkTransition(order.shipments, "ON_THE_WAY", actorId);
    return this.getOrderById(orderId);
  }

  async confirmArrival(orderId: string, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notEnroute = order.shipments.filter((s) => s.status !== "ON_THE_WAY");
    if (notEnroute.length > 0) throw new ConflictError("All items must be en route before confirming arrival");

    await this.bulkTransition(order.shipments, "ARRIVED", actorId);
    return this.getOrderById(orderId);
  }

  async completeOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unresolved = order.shipments.filter((s) => s.status !== "COMPLETED" && s.status !== "ISSUE_RAISED");
    if (unresolved.length > 0) {
      throw new ConflictError("All items must be completed or have an issue raised before the order can be completed");
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { allItemsResolved: true, completedAt: new Date() },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async bulkTransition(shipments: Shipment[], status: ShipmentStatus, actorId: string) {
    await this.prisma.$transaction([
      ...shipments.map((s) => this.prisma.shipment.update({ where: { id: s.id }, data: { status } })),
      this.prisma.shipmentStatusEvent.createMany({
        data: shipments.map((s) => ({ shipmentId: s.id, status, actorType: "pilot", actorId })),
      }),
    ]);
  }
}