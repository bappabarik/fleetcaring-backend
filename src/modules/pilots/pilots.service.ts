import type { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/passwords.js";
import type { CreatePilotBody, UpdatePilotBody, UpdateMyPilotPreferencesBody } from "./pilots.schemas.js";

/**
 * Explicit allow-list, never an implicit "return everything" — this is
 * what actually fixes the passwordHash leak. Every method below returns
 * through this select, including the ones that existed before this fix.
 */
const SAFE_PILOT_SELECT = {
  id: true,
  code: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneNumber: true,
  verticalId: true,
  status: true,
  preferredNavApp: true,
  language: true,
  createdAt: true,
} as const;

export class PilotsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listPilots() {
    return this.prisma.pilot.findMany({ orderBy: { createdAt: "desc" }, select: SAFE_PILOT_SELECT });
  }

  async getPilotById(id: string) {
    const pilot = await this.prisma.pilot.findUnique({ where: { id }, select: SAFE_PILOT_SELECT });
    if (!pilot) throw new NotFoundError("Pilot not found");
    return pilot;
  }

  async createPilot(data: CreatePilotBody) {
    const existingByEmail = await this.prisma.pilot.findUnique({ where: { email: data.email } });
    if (existingByEmail) throw new ConflictError("A pilot with this email already exists");

    const existingByPhone = await this.prisma.pilot.findUnique({ where: { phoneNumber: data.phoneNumber } });
    if (existingByPhone) throw new ConflictError("A pilot with this phone number already exists");

    const existingByCode = await this.prisma.pilot.findUnique({ where: { code: data.code } });
    if (existingByCode) throw new ConflictError("A pilot with this code already exists");

    const passwordHash = data.password ? await hashPassword(data.password) : undefined;

    return this.prisma.pilot.create({
      data: {
        code: data.code,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phoneNumber: data.phoneNumber,
        verticalId: data.verticalId,
        passwordHash,
      },
      select: SAFE_PILOT_SELECT,
    });
  }

  async updatePilot(id: string, data: UpdatePilotBody) {
    const pilot = await this.prisma.pilot.findUnique({ where: { id } });
    if (!pilot) throw new NotFoundError("Pilot not found");
    return this.prisma.pilot.update({ where: { id }, data, select: SAFE_PILOT_SELECT });
  }

  // ---------- Pilot self-service ----------

  async getMyProfile(pilotId: string) {
    return this.getPilotById(pilotId);
  }

  /** Deliberately narrow scope — a pilot can set their own nav-app and
   * language preference, but NOT their name/email/phone/code/status.
   * Those are identity/HR-managed fields and stay admin-only
   * (updatePilot above); letting a pilot self-edit their own phone number,
   * for instance, would let them redirect their own OTP login to a
   * different number without any oversight. */
  async updateMyPreferences(pilotId: string, data: UpdateMyPilotPreferencesBody) {
    const pilot = await this.prisma.pilot.findUnique({ where: { id: pilotId } });
    if (!pilot) throw new NotFoundError("Pilot not found");
    return this.prisma.pilot.update({ where: { id: pilotId }, data, select: SAFE_PILOT_SELECT });
  }
}