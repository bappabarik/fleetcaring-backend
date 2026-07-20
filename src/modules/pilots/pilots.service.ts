import type { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/passwords.js";
import type { CreatePilotBody, UpdatePilotBody } from "./pilots.schemas.js";

export class PilotsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listPilots() {
    return this.prisma.pilot.findMany({ orderBy: { createdAt: "desc" } });
  }

  async getPilotById(id: string) {
    const pilot = await this.prisma.pilot.findUnique({ where: { id } });
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
    });
  }

  async updatePilot(id: string, data: UpdatePilotBody) {
    const pilot = await this.prisma.pilot.findUnique({ where: { id } });
    if (!pilot) throw new NotFoundError("Pilot not found");
    return this.prisma.pilot.update({ where: { id }, data });
  }
}