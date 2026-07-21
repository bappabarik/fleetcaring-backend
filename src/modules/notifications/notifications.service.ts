import type { FastifyInstance } from "fastify";
import type { ActorType } from "../../types/auth.js";

export interface PushJobData {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export class NotificationsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async notifyActor(
    actorType: Extract<ActorType, "CUSTOMER" | "PILOT">,
    actorId: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ) {
    const deviceTokens = await this.prisma.deviceToken.findMany({
      where: actorType === "CUSTOMER" ? { userId: actorId } : { pilotId: actorId },
    });

    if (deviceTokens.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const dt of deviceTokens as any[]) {
      await this.app.pushQueue.add("send-push", { token: dt.token, title, body, data } satisfies PushJobData);
    }
  }
}