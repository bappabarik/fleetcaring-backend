import type { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/passwords.js";
import { SAFE_PILOT_SELECT } from "../../lib/safeSelects.js";
import type {
  CreatePilotBody,
  UpdatePilotBody,
  UpdateMyPilotPreferencesBody,
  ListPilotsQuery,
} from "./pilots.schemas.js";

export class PilotsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listPilots(filters: ListPilotsQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: "insensitive" } },
        { lastName: { contains: filters.search, mode: "insensitive" } },
        { code: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
        { phoneNumber: { contains: filters.search } },
      ];
    }

    const pilots = await this.prisma.pilot.findMany({
      where,
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      select: SAFE_PILOT_SELECT,
    });

    const hasMore = pilots.length > filters.limit;
    const page = hasMore ? pilots.slice(0, -1) : pilots;

    return {
      items: page,
      nextCursor: hasMore ? (page[page.length - 1] as { id: string }).id : null,
    };
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

  async updateMyPreferences(pilotId: string, data: UpdateMyPilotPreferencesBody) {
    const pilot = await this.prisma.pilot.findUnique({ where: { id: pilotId } });
    if (!pilot) throw new NotFoundError("Pilot not found");
    return this.prisma.pilot.update({ where: { id: pilotId }, data, select: SAFE_PILOT_SELECT });
  }
}