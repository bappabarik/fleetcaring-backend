import type { FastifyInstance } from "fastify";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { SAFE_PILOT_SELECT } from "../../lib/safeSelects.js";
import { startOfDay } from "../../lib/dateUtils.js";
import { ACTIVE_SHIPMENT_STATUSES } from "../../lib/shipmentStatus.js";
import type { CreateShiftBody, StartBreakBody, ListShiftsQuery } from "./shifts.schemas.js";

const DEFAULT_BREAK_MINUTES = 60;

export class ShiftsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  // ---------- Admin: scheduling ----------

  async createShift(data: CreateShiftBody) {
    const pilot = await this.prisma.pilot.findUnique({ where: { id: data.pilotId } });
    if (!pilot) throw new NotFoundError("Pilot not found");
    const asset = await this.prisma.asset.findUnique({ where: { id: data.assetId } });
    if (!asset) throw new NotFoundError("Asset not found");
    const zone = await this.prisma.zone.findUnique({ where: { id: data.zoneId } });
    if (!zone) throw new NotFoundError("Zone not found");

    // Prevent double-booking: neither this pilot nor this asset can have
    // another active/scheduled shift whose time range overlaps this one.
    const overlappingPilotShift = await this.prisma.shift.findFirst({
      where: {
        pilotId: data.pilotId,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startTime: { lt: data.endTime },
        endTime: { gt: data.startTime },
      },
    });
    if (overlappingPilotShift) throw new ConflictError("This pilot already has an overlapping shift");

    const overlappingAssetShift = await this.prisma.shift.findFirst({
      where: {
        assetId: data.assetId,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startTime: { lt: data.endTime },
        endTime: { gt: data.startTime },
      },
    });
    if (overlappingAssetShift) throw new ConflictError("This asset already has an overlapping shift");

    const shift = await this.prisma.shift.create({ data });
    await this.prisma.shiftEvent.create({ data: { shiftId: shift.id, eventType: "created" } });
    return shift;
  }

  async listShifts(filters: ListShiftsQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.pilotId) where.pilotId = filters.pilotId;
    if (filters.zoneId) where.zoneId = filters.zoneId;
    if (filters.status) where.status = filters.status;
    if (filters.dateFrom || filters.dateTo) {
      where.startTime = {};
      if (filters.dateFrom) where.startTime.gte = filters.dateFrom;
      if (filters.dateTo) where.startTime.lte = filters.dateTo;
    }

    const shifts = await this.prisma.shift.findMany({
      where,
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      include: { pilot: { select: SAFE_PILOT_SELECT }, asset: true, zone: true },
      orderBy: { startTime: "desc" },
    });

    const hasMore = shifts.length > filters.limit;
    const page = hasMore ? shifts.slice(0, -1) : shifts;

    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getShiftById(id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: { pilot: { select: SAFE_PILOT_SELECT }, asset: true, zone: true, breaks: true, events: true },
    });
    if (!shift) throw new NotFoundError("Shift not found");
    return shift;
  }

  // ---------- Pilot: start/end shift ----------

  async startShift(shiftId: string, actorId: string) {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundError("Shift not found");
    if (shift.pilotId !== actorId) throw new ForbiddenError("This is not your shift");
    if (shift.status !== "SCHEDULED") {
      throw new ConflictError(`Shift can only be started from SCHEDULED (current: ${shift.status})`);
    }

    await this.prisma.$transaction([
      this.prisma.shift.update({ where: { id: shiftId }, data: { status: "IN_PROGRESS" } }),
      this.prisma.shiftEvent.create({ data: { shiftId, eventType: "started", actorId } }),
    ]);

    return this.getShiftById(shiftId);
  }

  async endShift(shiftId: string, actorId: string) {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundError("Shift not found");
    if (shift.pilotId !== actorId) throw new ForbiddenError("This is not your shift");
    if (shift.status !== "IN_PROGRESS") {
      throw new ConflictError(`Shift can only be ended from IN_PROGRESS (current: ${shift.status})`);
    }

    const activeBreak = await this.prisma.pilotBreak.findFirst({ where: { shiftId, endedAt: null } });
    if (activeBreak) throw new ConflictError("End your current break before ending the shift");

    await this.prisma.$transaction([
      this.prisma.shift.update({ where: { id: shiftId }, data: { status: "COMPLETED" } }),
      this.prisma.shiftEvent.create({ data: { shiftId, eventType: "ended", actorId } }),
    ]);

    return this.getShiftById(shiftId);
  }

  // ---------- Breaks ----------

  async startBreak(shiftId: string, actorId: string, data: StartBreakBody) {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundError("Shift not found");
    if (shift.pilotId !== actorId) throw new ForbiddenError("This is not your shift");
    if (shift.status !== "IN_PROGRESS") {
      throw new ConflictError("You can only take a break during an active shift");
    }

    const existingActiveBreak = await this.prisma.pilotBreak.findFirst({ where: { shiftId, endedAt: null } });
    if (existingActiveBreak) throw new ConflictError("You're already on a break");

    return this.prisma.pilotBreak.create({
      data: {
        shiftId,
        reason: data.reason,
        durationAllowedMins: data.durationAllowedMins ?? DEFAULT_BREAK_MINUTES,
      },
    });
  }

  async endBreak(shiftId: string, breakId: string, actorId: string) {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundError("Shift not found");
    if (shift.pilotId !== actorId) throw new ForbiddenError("This is not your shift");

    const pilotBreak = await this.prisma.pilotBreak.findUnique({ where: { id: breakId } });
    if (!pilotBreak || pilotBreak.shiftId !== shiftId) throw new NotFoundError("Break not found on this shift");
    if (pilotBreak.endedAt) throw new ConflictError("This break has already ended");

    return this.prisma.pilotBreak.update({ where: { id: breakId }, data: { endedAt: new Date() } });
  }

  /** Called by the break-expiry BullMQ worker on a short interval — closes
   * out any break whose countdown ran out without the pilot manually
   * ending it, matching the pilot app's "Break remaining 00:00" timer
   * hitting zero. Sets endedAt to when it SHOULD have ended (start +
   * allowance), not "now", so the recorded duration is accurate. */
  async expireOverdueBreaks(): Promise<{ expired: number }> {
    const activeBreaks = await this.prisma.pilotBreak.findMany({ where: { endedAt: null } });
    const now = Date.now();

    let expiredCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of activeBreaks as any[]) {
      const deadline = b.startedAt.getTime() + b.durationAllowedMins * 60_000;
      if (deadline <= now) {
        await this.prisma.$transaction([
          this.prisma.pilotBreak.update({ where: { id: b.id }, data: { endedAt: new Date(deadline) } }),
          this.prisma.shiftEvent.create({
            data: { shiftId: b.shiftId, eventType: "break_expired", actorId: null },
          }),
        ]);
        expiredCount++;
      }
    }

    return { expired: expiredCount };
  }

  /**
   * Called by the shift-expiry BullMQ worker on a short interval. Closes
   * out shift lifecycles the clock has moved past but no human action did:
   *
   * - IN_PROGRESS past its endTime: if the pilot has no shipment still
   *   actively in flight, the shift is genuinely done — auto-complete it
   *   right then. If they DO have active work (a job running long), leave
   *   it running as overtime rather than yanking it out from under an
   *   active delivery.
   * - Anything — IN_PROGRESS or SCHEDULED — still open from a PREVIOUS
   *   calendar day is force-closed regardless of idle state, as a hard
   *   backstop: nothing should ever carry across a day boundary. A
   *   lingering IN_PROGRESS becomes COMPLETED (it happened, just never
   *   got tapped closed); a SCHEDULED shift that was never started at all
   *   becomes NO_SHOW.
   */
  async expireOverdueShifts(): Promise<{ completed: number; noShow: number }> {
    const now = new Date();
    const todayStart = startOfDay(now);

    let completed = 0;
    let noShow = 0;

    const overdueInProgress = await this.prisma.shift.findMany({
      where: { status: "IN_PROGRESS", endTime: { lt: now } },
    });

    for (const shift of overdueInProgress) {
      const dayRolledOver = shift.endTime < todayStart;

      let pilotIsIdle = true;
      if (!dayRolledOver) {
        const activeShipment = await this.prisma.shipment.findFirst({
          where: { pilotId: shift.pilotId, status: { in: ACTIVE_SHIPMENT_STATUSES } },
        });
        pilotIsIdle = !activeShipment;
      }

      if (dayRolledOver || pilotIsIdle) {
        await this.prisma.$transaction([
          this.prisma.shift.update({ where: { id: shift.id }, data: { status: "COMPLETED" } }),
          this.prisma.shiftEvent.create({
            data: {
              shiftId: shift.id,
              eventType: dayRolledOver ? "auto_completed_day_rollover" : "auto_completed",
              actorId: null,
            },
          }),
        ]);
        completed++;
      }
      // else: still actively working past endTime — leave it running as overtime.
    }

    const noShowShifts = await this.prisma.shift.findMany({
      where: { status: "SCHEDULED", endTime: { lt: todayStart } },
    });

    for (const shift of noShowShifts) {
      await this.prisma.$transaction([
        this.prisma.shift.update({ where: { id: shift.id }, data: { status: "NO_SHOW" } }),
        this.prisma.shiftEvent.create({ data: { shiftId: shift.id, eventType: "no_show", actorId: null } }),
      ]);
      noShow++;
    }

    return { completed, noShow };
  }

  // ---------- Pilot-facing dashboard summary ----------

  /** Matches the pilot app's home screen states: "No shift" (with next
   * scheduled shift if any), "Shift starts in X" (scheduled, not started),
   * "On duty" (in progress, no active break), or "On break" (in progress,
   * with an active break and its remaining minutes). */
  async getPilotDashboard(pilotId: string) {
  const now = new Date();

  const inProgressShift = await this.prisma.shift.findFirst({
    where: { pilotId, status: "IN_PROGRESS" },
    include: { asset: true, zone: true },
  });

  if (inProgressShift) {
    const activeBreak = await this.prisma.pilotBreak.findFirst({
      where: { shiftId: inProgressShift.id, endedAt: null },
    });

    return {
      state: activeBreak ? "ON_BREAK" : "ON_DUTY",
      shift: inProgressShift,
      activeBreak: activeBreak
        ? {
            ...activeBreak,
            remainingMins: Math.max(
              0,
              Math.round(
                (activeBreak.startedAt.getTime() +
                  activeBreak.durationAllowedMins * 60_000 -
                  now.getTime()) /
                  60_000
              )
            ),
          }
        : null,
    };
  }

  // Changed: endTime (not startTime) — a SCHEDULED shift whose start
  // time has already arrived (or even slightly passed) but hasn't ended
  // yet should still show up as the pilot's shift, not vanish the
  // instant its nominal start time ticks by.
  const nextShift = await this.prisma.shift.findFirst({
    where: { pilotId, status: "SCHEDULED", endTime: { gte: now } },
    orderBy: { startTime: "asc" },
    include: { asset: true, zone: true },
  });

  return {
    state: nextShift ? "SHIFT_SCHEDULED" : "NO_SHIFT",
    shift: nextShift ?? null,
    activeBreak: null,
  };
}
}