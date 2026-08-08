import type { FastifyInstance } from "fastify";
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from "../../lib/errors.js";
import { notifyOrderUpdate } from "../../lib/orderNotify.js";
import { startOfDay, addDays } from "../../lib/dateUtils.js";
import { ACTIVE_SHIPMENT_STATUSES } from "../../lib/shipmentStatus.js";
import type { AssignShipmentBody, CheckSubmissionBody, RaiseIssueBody } from "./shipments.schemas.js";
import { Prisma } from "@prisma/client";

const MIN_CHECK_PHOTOS = 2;

/**
 * NOTE: `tx: any` in the transaction callbacks below is deliberate — same
 * reasoning as in TimeslotsService. Tighten to Prisma.TransactionClient
 * once `prisma generate` has run for real and this can be verified.
 */
export class ShipmentsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async assign(shipmentId: string, data: AssignShipmentBody, actorId?: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { order: { include: { timeslot: true } } },
    });
    if (!shipment) throw new NotFoundError("Shipment not found");

    // Once a pilot has actually started this shipment (or finished it),
    // reassigning it here would silently regress its status back to
    // ASSIGNED and swap out the pilot/asset mid-delivery with no
    // notification to whoever was already on it. That needs to be a
    // deliberate, separate "reassign mid-flight" action if it's ever
    // built — not something this endpoint does implicitly.
    if (shipment.status !== "CREATED" && shipment.status !== "ASSIGNED") {
      throw new ConflictError(
        `This shipment is already ${shipment.status.toLowerCase().replace(/_/g, " ")} and can't be reassigned here`
      );
    }

    const pilot = await this.prisma.pilot.findUnique({ where: { id: data.pilotId } });
    if (!pilot) throw new NotFoundError("Pilot not found");
    if (pilot.status !== "ACTIVE") {
      throw new ConflictError(`This pilot is currently ${pilot.status.toLowerCase()} and cannot be assigned`);
    }

    const asset = await this.prisma.asset.findUnique({ where: { id: data.assetId } });
    if (!asset) throw new NotFoundError("Asset not found");
    if (!asset.isActive) throw new ConflictError("This asset is currently inactive and cannot be assigned");

    // Neither a pilot nor a physical asset can be dispatched to two places
    // at once — check for any OTHER still-active shipment (for either
    // this pilot or this asset) whose order's timeslot overlaps this
    // shipment's own timeslot. There was previously no FK constraint and
    // no check of any kind here at all.
    const { startTime, endTime } = shipment.order.timeslot;

    const conflictingPilotShipment = await this.prisma.shipment.findFirst({
      where: {
        id: { not: shipmentId },
        pilotId: data.pilotId,
        status: { in: ACTIVE_SHIPMENT_STATUSES },
        order: { timeslot: { startTime: { lt: endTime }, endTime: { gt: startTime } } },
      },
    });
    if (conflictingPilotShipment) {
      throw new ConflictError("This pilot is already assigned to another shipment during this time slot");
    }

    const conflictingAssetShipment = await this.prisma.shipment.findFirst({
      where: {
        id: { not: shipmentId },
        assetId: data.assetId,
        status: { in: ACTIVE_SHIPMENT_STATUSES },
        order: { timeslot: { startTime: { lt: endTime }, endTime: { gt: startTime } } },
      },
    });
    if (conflictingAssetShipment) {
      throw new ConflictError("This asset is already assigned to another shipment during this time slot");
    }

    await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { pilotId: data.pilotId, assetId: data.assetId, status: "ASSIGNED" },
    });
    await this.prisma.shipmentStatusEvent.create({
      data: { shipmentId, status: "ASSIGNED", actorType: "admin", actorId },
    });
    await notifyOrderUpdate(this.app, shipment.orderId, shipmentId, "ASSIGNED");

    return this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  }

  async submitPreCheck(shipmentId: string, actorId: string, data: CheckSubmissionBody) {
    this.assertEnoughPhotos(data.photoUrls);

    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundError("Shipment not found");
    if (shipment.pilotId !== actorId) throw new ForbiddenError("This shipment is not assigned to you");
    if (shipment.status !== "ARRIVED") {
      throw new ConflictError(`Pre-check can only be submitted once arrived (current status: ${shipment.status})`);
    }

    await this.assertCheckNotAlreadyConfirmed(shipmentId, "PRE");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.vehicleCheck.upsert({
        where: { shipmentId_phase: { shipmentId, phase: "PRE" } },
        update: { photoUrls: data.photoUrls, notes: data.notes, confirmedAt: new Date() },
        create: { shipmentId, phase: "PRE", photoUrls: data.photoUrls, notes: data.notes, confirmedAt: new Date() },
      });
      await tx.shipment.update({ where: { id: shipmentId }, data: { status: "IN_PROGRESS" } });
      await tx.shipmentStatusEvent.create({
        data: { shipmentId, status: "IN_PROGRESS", actorType: "pilot", actorId },
      });
    });

    await notifyOrderUpdate(this.app, shipment.orderId, shipmentId, "IN_PROGRESS");

    return this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { checks: true } });
  }

  async submitPostCheck(shipmentId: string, actorId: string, data: CheckSubmissionBody) {
    this.assertEnoughPhotos(data.photoUrls);

    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundError("Shipment not found");
    if (shipment.pilotId !== actorId) throw new ForbiddenError("This shipment is not assigned to you");
    if (shipment.status !== "IN_PROGRESS") {
      throw new ConflictError(`Post-check can only be submitted while in progress (current status: ${shipment.status})`);
    }

    await this.assertCheckNotAlreadyConfirmed(shipmentId, "POST");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.vehicleCheck.upsert({
        where: { shipmentId_phase: { shipmentId, phase: "POST" } },
        update: { photoUrls: data.photoUrls, notes: data.notes, confirmedAt: new Date() },
        create: { shipmentId, phase: "POST", photoUrls: data.photoUrls, notes: data.notes, confirmedAt: new Date() },
      });
      await tx.shipment.update({ where: { id: shipmentId }, data: { status: "COMPLETED" } });
      await tx.shipmentStatusEvent.create({
        data: { shipmentId, status: "COMPLETED", actorType: "pilot", actorId },
      });
    });

    await this.recomputeOrderResolution(shipment.orderId);
    await notifyOrderUpdate(this.app, shipment.orderId, shipmentId, "COMPLETED");

    return this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { checks: true } });
  }

  async raiseIssue(orderId: string, actorId: string, data: RaiseIssueBody) {
    this.assertEnoughPhotos(data.photoUrls);

    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    if (data.shipmentId) {
      const shipment = await this.prisma.shipment.findUnique({ where: { id: data.shipmentId } });
      if (!shipment || shipment.orderId !== orderId) throw new NotFoundError("Shipment not found on this order");
      if (shipment.pilotId !== actorId) throw new ForbiddenError("This shipment is not assigned to you");
    } else {
      // Order-wide issue (e.g. "unable to reach location") — the pilot
      // must own at least one shipment on this order to raise it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ownsAny = order.shipments.some((s: any) => s.pilotId === actorId);
      if (!ownsAny) throw new ForbiddenError("You are not assigned to any item on this order");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const issue = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.issue.create({
        data: {
          orderId,
          shipmentId: data.shipmentId ?? null,
          reason: data.reason,
          notes: data.notes,
          photoUrls: data.photoUrls,
          raisedById: actorId,
        },
      });

      if (data.shipmentId) {
        await tx.shipment.update({ where: { id: data.shipmentId }, data: { status: "ISSUE_RAISED" } });
        await tx.shipmentStatusEvent.create({
          data: { shipmentId: data.shipmentId, status: "ISSUE_RAISED", actorType: "pilot", actorId },
        });
      }

      return created;
    });

    if (data.shipmentId) {
      await this.recomputeOrderResolution(orderId);
      await notifyOrderUpdate(this.app, orderId, data.shipmentId, "ISSUE_RAISED");
    }

    return issue;
  }

  // ---------- Pilot task list ("my assigned work") ----------

  /** Matches the pilot app's core task-list screen: every shipment
   * assigned to this pilot, defaulting to today, with everything a task
   * card needs to render — customer contact, address, vehicle, service,
   * scheduled window, and whether an issue is already open on it. Cursor-
   * paginated like every other list endpoint, even though daily volume
   * per pilot is naturally small. */
  async listMyShipments(pilotId: string, filters: { date?: Date; statuses?: string[]; limit: number; cursor?: string }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { pilotId };

    if (filters.statuses && filters.statuses.length > 0) {
      where.status = { in: filters.statuses };
    }

    const targetDate = filters.date ?? new Date();
    const dayStart = startOfDay(targetDate);
    const dayEnd = addDays(dayStart, 1);
    where.order = { timeslot: { date: { gte: dayStart, lt: dayEnd } } };

    const shipments = await this.prisma.shipment.findMany({
      where,
      take: filters.limit + 1, // fetch one extra to know if there's a next page
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "asc" },
      include: {
        order: {
          include: {
            user: true,
            address: { include: { zone: true } },
            timeslot: true,
          },
        },
        vehicle: true,
        itemVariation: { include: { opItem: true } },
        addOns: { include: { itemVariation: true } },
        issues: true,
      },
    });

    const hasMore = shipments.length > filters.limit;
    const page = hasMore ? shipments.slice(0, -1) : shipments;

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: page.map((s: any) => mapShipmentToTaskCard(s)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // ---------- Internal helpers ----------

  private assertEnoughPhotos(photoUrls: string[]) {
    if (photoUrls.length < MIN_CHECK_PHOTOS) {
      throw new BadRequestError(`At least ${MIN_CHECK_PHOTOS} photos are required`);
    }
  }

  private async assertCheckNotAlreadyConfirmed(shipmentId: string, phase: "PRE" | "POST") {
    const existing = await this.prisma.vehicleCheck.findUnique({
      where: { shipmentId_phase: { shipmentId, phase } },
    });
    if (existing?.confirmedAt) {
      throw new ConflictError(`${phase === "PRE" ? "Pre" : "Post"}-check has already been confirmed and cannot be changed`);
    }
  }

  /** Recomputes Order.allItemsResolved — true once every shipment on the
   * order is COMPLETED or has had an Issue raised against it. This is the
   * gate the pilot app's "Complete order" button checks; it does NOT set
   * Order.completedAt itself — that only happens via the explicit
   * OrdersService.completeOrder() action. */
  private async recomputeOrderResolution(orderId: string) {
    const shipments = await this.prisma.shipment.findMany({ where: { orderId } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allResolved = shipments.every((s) => s.status === "COMPLETED" || s.status === "ISSUE_RAISED");
    await this.prisma.order.update({ where: { id: orderId }, data: { allItemsResolved: allResolved } });
  }
}

/** Shapes the raw nested Prisma result into a clean, flat-ish contract for
 * the pilot app's task card — deliberately not just forwarding the ORM's
 * include-tree shape, since that couples the API response to our internal
 * relation structure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapShipmentToTaskCard(shipment: any) {
  return {
    shipmentId: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    status: shipment.status,
    order: {
      id: shipment.order.id,
      orderNumber: shipment.order.orderNumber,
      total: shipment.order.total,
    },
    scheduledDate: shipment.order.timeslot.date,
    scheduledStartTime: shipment.order.timeslot.startTime,
    scheduledEndTime: shipment.order.timeslot.endTime,
    customer: {
      name: shipment.order.user.name,
      phoneNumber: shipment.order.user.phoneNumber,
    },
    address: {
      label: shipment.order.address.label,
      addressText: shipment.order.address.addressText,
      latitude: shipment.order.address.latitude,
      longitude: shipment.order.address.longitude,
      notes: shipment.order.address.notes,
      zoneName: shipment.order.address.zone?.name ?? null,
    },
    vehicle: {
      make: shipment.vehicle.make,
      model: shipment.vehicle.model,
      licensePlate: shipment.vehicle.licensePlate,
      color: shipment.vehicle.color,
    },
    service: {
      name: shipment.itemVariation.name,
      opItemName: shipment.itemVariation.opItem.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addOns: shipment.addOns.map((a: any) => a.itemVariation.name),
    },
    hasOpenIssue: shipment.issues.length > 0,
  };
}