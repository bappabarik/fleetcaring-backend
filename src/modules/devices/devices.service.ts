import type { FastifyInstance } from "fastify";
import { ForbiddenError } from "../../lib/errors.js";
import type { ActorType } from "../../types/auth.js";
import type { RegisterDeviceTokenBody } from "./devices.schemas.js";

export class DevicesService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async registerDeviceToken(actorType: ActorType, actorId: string, data: RegisterDeviceTokenBody) {
    if (actorType !== "CUSTOMER" && actorType !== "PILOT") {
      throw new ForbiddenError("Only customers and pilots can register device tokens");
    }

    return this.prisma.deviceToken.upsert({
      where: { token: data.token },
      update: {
        actorType,
        userId: actorType === "CUSTOMER" ? actorId : null,
        pilotId: actorType === "PILOT" ? actorId : null,
        platform: data.platform,
      },
      create: {
        actorType,
        userId: actorType === "CUSTOMER" ? actorId : null,
        pilotId: actorType === "PILOT" ? actorId : null,
        token: data.token,
        platform: data.platform,
      },
    });
  }

  async unregisterDeviceToken(actorType: ActorType, actorId: string, token: string): Promise<void> {
    const existing = await this.prisma.deviceToken.findUnique({ where: { token } });
    if (!existing) return;

    const ownsIt = actorType === "CUSTOMER" ? existing.userId === actorId : existing.pilotId === actorId;
    if (!ownsIt) return;

    await this.prisma.deviceToken.delete({ where: { token } });
  }
}