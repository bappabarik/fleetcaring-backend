import type { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import { startOfDay, addDays, generateMatchingDates, combineDateAndTime } from "../../lib/dateUtils.js";
import type { CreateTemplateBody, UpdateTemplateBody } from "./timeslots.schemas.js";
import { Prisma } from "@prisma/client";

const DEFAULT_MATERIALIZATION_WINDOW_DAYS = 14;

/**
 * NOTE: the `tx: any` in bookSlot/releaseSlot's $transaction callbacks
 * below is deliberate, not sloppy — Prisma's transaction-client type
 * isn't reliably inferable against a not-yet-generated client, and a
 * hand-written interface here risks silently drifting from the real
 * generated shape. Once `prisma generate` has run for real, feel free to
 * tighten this to `Prisma.TransactionClient` and re-run typecheck.
 */
export class TimeslotsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  // ---------- Templates ----------

  async createTemplate(data: CreateTemplateBody) {
    const template = await this.prisma.timeslotTemplate.create({ data });
    const { created } = await this.materializeTemplate(template.id);
    return { template, slotsCreated: created };
  }

  async listTemplates() {
    return this.prisma.timeslotTemplate.findMany({
      include: { opItem: true, zone: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateTemplate(id: string, data: UpdateTemplateBody) {
    const template = await this.prisma.timeslotTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundError("Timeslot template not found");
    return this.prisma.timeslotTemplate.update({ where: { id }, data });
  }

  // ---------- Materialization ----------

  async materializeTemplate(templateId: string, windowDays = DEFAULT_MATERIALIZATION_WINDOW_DAYS): Promise<{ created: number }> {
    const template = await this.prisma.timeslotTemplate.findUniqueOrThrow({ where: { id: templateId } });
    if (!template.isActive) return { created: 0 };

    const today = startOfDay(new Date());
    const windowEnd = addDays(today, windowDays);

    const rangeStart = template.startDate > today ? template.startDate : today;
    const rangeEnd = template.endDate && template.endDate < windowEnd ? template.endDate : windowEnd;

    if (rangeStart > rangeEnd) return { created: 0 };

    const dates = generateMatchingDates(rangeStart, rangeEnd, template.recurrenceRule);

    const rows = dates.map((date) => ({
      templateId: template.id,
      opItemId: template.opItemId,
      zoneId: template.zoneId,
      date,
      startTime: combineDateAndTime(date, template.startTime),
      endTime: combineDateAndTime(date, template.endTime),
      capacity: template.capacity,
      buffer: template.buffer,
      timeslotType: template.timeslotType,
    }));

    if (rows.length === 0) return { created: 0 };

    const result = await this.prisma.timeslot.createMany({ data: rows, skipDuplicates: true });
    return { created: result.count };
  }

  async materializeAllActiveTemplates(windowDays = DEFAULT_MATERIALIZATION_WINDOW_DAYS) {
    const templates = await this.prisma.timeslotTemplate.findMany({ where: { isActive: true } });

    let slotsCreated = 0;
    for (const template of templates) {
      const { created } = await this.materializeTemplate(template.id, windowDays);
      slotsCreated += created;
    }

    return { templatesProcessed: templates.length, slotsCreated };
  }

  // ---------- Browsing available slots (customer-facing) ----------

  async listAvailableSlots(opItemId: string, zoneId: string, date: Date) {
    const dayStart = startOfDay(date);
    const dayEnd = addDays(dayStart, 1);

    return this.prisma.timeslot.findMany({
      where: {
        opItemId,
        zoneId,
        date: { gte: dayStart, lt: dayEnd },
        // Cutoff is the slot's own start time — once it's begun, it's no
        // longer bookable, even if it's still "today". This is the
        // customer-facing filter; bookSlotInTransaction enforces the same
        // cutoff again atomically, so this alone isn't the only guard.
        startTime: { gt: new Date() },
      },
      orderBy: { startTime: "asc" },
    });
  }

  // ---------- Capacity booking (atomic, race-safe) ----------

  async bookSlot(timeslotId: string, actorId?: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.bookSlotInTransaction(tx, timeslotId, actorId);
    });
  }

  /**
   * Same booking logic as bookSlot(), but takes an existing transaction
   * client instead of opening its own — this is what lets order creation
   * book the slot and create the order+shipments as one atomic unit,
   * rather than two separate transactions that could partially succeed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async bookSlotInTransaction(tx: Prisma.TransactionClient, timeslotId: string, actorId?: string): Promise<void> {
    // The startTime cutoff lives in this same atomic UPDATE (not a
    // separate "check then act" step) so there's no race between reading
    // the slot's time and booking it — same reasoning as the capacity
    // check it's already sitting next to.
    const updatedCount = await tx.$executeRaw`
      UPDATE "Timeslot"
      SET "bookedCount" = "bookedCount" + 1
      WHERE id = ${timeslotId} AND "bookedCount" < (capacity - buffer) AND "startTime" > NOW()
    `;

    if (updatedCount === 0) {
      const slot = await tx.timeslot.findUnique({ where: { id: timeslotId } });
      if (!slot) throw new NotFoundError("Time slot not found");
      if (slot.startTime <= new Date()) throw new ConflictError("This time slot has already passed");
      throw new ConflictError("This time slot is fully booked");
    }

    await tx.timeslotCapacityLog.create({
      data: { timeslotId, changeType: "booked", delta: 1, actorId },
    });
  }

  async releaseSlot(timeslotId: string, actorId?: string, reason?: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.releaseSlotInTransaction(tx, timeslotId, actorId, reason);
    });
  }

  /** Same release logic as releaseSlot(), but composable into a caller's
   * own transaction — needed so order cancellation can release capacity,
   * cancel every shipment, and mark the order cancelled as one atomic
   * unit, the same reasoning as bookSlotInTransaction back in step 5. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async releaseSlotInTransaction(tx: Prisma.TransactionClient, timeslotId: string, actorId?: string, reason?: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Timeslot"
      SET "bookedCount" = GREATEST("bookedCount" - 1, 0)
      WHERE id = ${timeslotId}
    `;

    await tx.timeslotCapacityLog.create({
      data: { timeslotId, changeType: "released", delta: -1, reason, actorId },
    });
  }

  async getCapacityLog(timeslotId: string) {
    return this.prisma.timeslotCapacityLog.findMany({
      where: { timeslotId },
      orderBy: { createdAt: "desc" },
    });
  }
}