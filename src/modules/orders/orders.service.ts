import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "../../lib/errors.js";
import { TimeslotsService } from "../timeslots/timeslots.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { PaymentsService } from "../payments/payments.service.js";
import { PromoCodesService } from "../promo-codes/promo-codes.service.js";
import { notifyOrderUpdate } from "../../lib/orderNotify.js";
import { isGeofencingEnabled } from "../../lib/settings.js";
import type { CreateOrderBody, ListOrdersQuery } from "./orders.schemas.js";
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

    const timeslot = await this.prisma.timeslot.findUnique({ where: { id: body.timeslotId } });
    if (!timeslot) throw new NotFoundError("Timeslot not found");

    // Geofencing enforcement: the address must actually be inside the same
    // zone the timeslot's capacity was allocated for. Without this check,
    // a customer could book a real, capacity-limited slot against an
    // address outside your coverage area entirely (address.zoneId null)
    // or in a different zone than the timeslot — nonsensical for pilot
    // dispatch, and a real gap that existed until this check was added.
    // Respects the admin-controlled toggle so testing doesn't require
    // every test address to fall inside a real zone.
    const geofencingEnabled = await isGeofencingEnabled(this.prisma);
    if (geofencingEnabled && (!address.zoneId || address.zoneId !== timeslot.zoneId)) {
      throw new ConflictError("This service is not available at the selected address's location");
    }

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
    const promoCodesService = new PromoCodesService(this.app);

    const basePricePerVehicle = await catalogService.resolveEffectivePrice(itemVariation.id, address.zoneId ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addOnsPricePerVehicle = addOnVariations.reduce((sum: number, v) => sum + Number(v.priceAED), 0);
    const subtotalAED = (basePricePerVehicle + addOnsPricePerVehicle) * vehicles.length;

    const orderId = randomUUID();

    // Everything below is one transaction: booking the timeslot's capacity,
    // validating+redeeming any promo code, and creating the order + its
    // shipments either all succeed together or all roll back together.
    // Promo validation happens INSIDE the transaction (not before it)
    // specifically so the redemption-limit check is atomic with the
    // order's own creation — two concurrent orders can't both pass a
    // "not yet at the limit" check before either commits.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await timeslotsService.bookSlotInTransaction(tx, body.timeslotId, userId);

      let discountAED = 0;
      let promoCodeId: string | null = null;
      if (body.promoCode) {
        const result = await promoCodesService.validatePromoCodeInTransaction(
          tx,
          body.promoCode,
          userId,
          subtotalAED
        );
        discountAED = result.discountAED;
        promoCodeId = result.promoCodeId;
      }

      const totalAED = Math.round((subtotalAED - discountAED) * 100) / 100;

      const orderNumber = await generateUniqueOrderNumber(tx);

      await tx.order.create({
        data: {
          id: orderId,
          orderNumber,
          userId,
          addressId: body.addressId,
          timeslotId: body.timeslotId,
          totalAED,
          discountAED,
          promoCodeId,
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

  async listOrdersForUser(userId: string, limit = 20, cursor?: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { shipments: true },
      orderBy: { createdAt: "desc" },
    });

    const hasMore = orders.length > limit;
    const page = hasMore ? orders.slice(0, -1) : orders;

    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async listAllOrders(filters: ListOrdersQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.status === "active") {
      where.completedAt = null;
      where.cancelledAt = null;
    } else if (filters.status === "completed") {
      where.completedAt = { not: null };
    } else if (filters.status === "cancelled") {
      where.cancelledAt = { not: null };
    }

    if (filters.zoneId) where.address = { zoneId: filters.zoneId };

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
      if (filters.dateTo) where.createdAt.lte = filters.dateTo;
    }

    if (filters.search) {
      where.OR = [
        { orderNumber: { contains: filters.search, mode: "insensitive" } },
        { user: { name: { contains: filters.search, mode: "insensitive" } } },
        { user: { phoneNumber: { contains: filters.search } } },
      ];
    }

    const orders = await this.prisma.order.findMany({
      where,
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      include: { shipments: true, user: true },
      orderBy: { createdAt: "desc" },
    });

    const hasMore = orders.length > filters.limit;
    const page = hasMore ? orders.slice(0, -1) : orders;

    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // ---------- Order-level pilot actions (bulk across all shipments) ----------

  async markEnroute(orderId: string, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notOwned = order.shipments.filter((s) => s.pilotId !== actorId);
    if (notOwned.length > 0) throw new ForbiddenError("You are not assigned to every item on this order");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notAssigned = order.shipments.filter((s) => s.status !== "ASSIGNED");
    if (notAssigned.length > 0) throw new ConflictError("All items must be assigned before starting the trip");

    const activeShift = await this.prisma.shift.findFirst({ where: { pilotId: actorId, status: "IN_PROGRESS" } });
    if (!activeShift) throw new ConflictError("You must start your shift before beginning a trip");

    await this.bulkTransition(order.shipments, "ON_THE_WAY", actorId);
    return this.getOrderById(orderId);
  }

  async confirmArrival(orderId: string, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notOwned = order.shipments.filter((s) => s.pilotId !== actorId);
    if (notOwned.length > 0) throw new ForbiddenError("You are not assigned to every item on this order");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notEnroute = order.shipments.filter((s) => s.status !== "ON_THE_WAY");
    if (notEnroute.length > 0) throw new ConflictError("All items must be en route before confirming arrival");

    await this.bulkTransition(order.shipments, "ARRIVED", actorId);
    return this.getOrderById(orderId);
  }

  async completeOrder(orderId: string, actorId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notOwned = order.shipments.filter((s) => s.pilotId !== actorId);
    if (notOwned.length > 0) throw new ForbiddenError("You are not assigned to every item on this order");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unresolved = order.shipments.filter((s) => s.status !== "COMPLETED" && s.status !== "ISSUE_RAISED");
    if (unresolved.length > 0) {
      throw new ConflictError("All items must be completed or have an issue raised before the order can be completed");
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { allItemsResolved: true, completedAt: new Date() },
    });

    await notifyOrderUpdate(this.app, orderId, null, "ORDER_COMPLETED");

    return updated;
  }

  /**
   * Cancellable only while every shipment is still CREATED or ASSIGNED —
   * once a pilot is en route (ON_THE_WAY) or further, the trip is already
   * committed and this simple flow no longer applies (would need ops
   * intervention, out of scope here). Either the order's own customer or
   * an admin (support cancelling on a customer's behalf) can call this.
   *
   * Refund ordering matters: if a payment was already captured, the
   * Stripe refund call happens FIRST, before touching our own database.
   * If the refund fails, nothing in our DB has changed yet — no
   * inconsistent "cancelled but never refunded" state is possible. Only
   * after a successful (or unnecessary) refund does the actual
   * cancellation transaction run.
   */
  async cancelOrder(orderId: string, actorId: string, actorType: "CUSTOMER" | "ADMIN", reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shipments: true, payment: true },
    });
    if (!order) throw new NotFoundError("Order not found");
    if (actorType === "CUSTOMER" && order.userId !== actorId) throw new ForbiddenError("Not your order");

    if (order.completedAt) throw new ConflictError("A completed order can't be cancelled");
    if (order.cancelledAt) throw new ConflictError("This order has already been cancelled");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const alreadyInProgress = order.shipments.some(
      (s) => s.status !== "CREATED" && s.status !== "ASSIGNED"
    );
    if (alreadyInProgress) {
      throw new ConflictError(
        "This order can no longer be cancelled — the pilot has already started the trip"
      );
    }

    if (order.payment && (order.payment.status === "CAPTURED" || order.payment.status === "HOLD_SUCCESS")) {
      const paymentsService = new PaymentsService(this.app);
      await paymentsService.refundPayment(orderId);
    }

    const timeslotsService = new TimeslotsService(this.app);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await timeslotsService.releaseSlotInTransaction(tx, order.timeslotId, actorId, reason ?? "Order cancelled");

      for (const shipment of order.shipments) {
        await tx.shipment.update({ where: { id: shipment.id }, data: { status: "CANCELLED" } });
        await tx.shipmentStatusEvent.create({
          data: { shipmentId: shipment.id, status: "CANCELLED", actorType: actorType.toLowerCase(), actorId },
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: { cancelledAt: new Date(), cancellationReason: reason ?? null },
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const shipment of order.shipments as any[]) {
      await notifyOrderUpdate(this.app, orderId, shipment.id, "CANCELLED");
    }
    await notifyOrderUpdate(this.app, orderId, null, "ORDER_CANCELLED");

    return this.getOrderById(orderId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async bulkTransition(shipments: Shipment[], status: ShipmentStatus, actorId: string) {
    await this.prisma.$transaction([
      ...shipments.map((s) => this.prisma.shipment.update({ where: { id: s.id }, data: { status } })),
      this.prisma.shipmentStatusEvent.createMany({
        data: shipments.map((s) => ({ shipmentId: s.id, status, actorType: "pilot", actorId })),
      }),
    ]);

    for (const s of shipments) {
      await notifyOrderUpdate(this.app, s.orderId, s.id, status);
    }
  }
}