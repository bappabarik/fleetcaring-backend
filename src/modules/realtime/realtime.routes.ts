import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { JwtPayload } from "../../types/auth.js";

const LOCATION_HISTORY_THROTTLE_MS = 20_000;
const lastPersistedAt = new Map<string, number>();

interface IncomingMessage {
  type: string;
  [key: string]: unknown;
}

export async function realtimeRoutes(app: FastifyInstance) {
  app.get("/connect", { websocket: true }, (socket: WebSocket, request) => {
    const query = request.query as { token?: string };
    const token = query.token;

    if (!token) {
      socket.close(4001, "Missing token");
      return;
    }

    let payload: JwtPayload;
    try {
      payload = app.jwt.verify<JwtPayload>(token);
    } catch {
      socket.close(4001, "Invalid token");
      return;
    }

    const subscribedChannels = new Set<string>();

    socket.on("message", (raw: Buffer) => {
      void handleMessage(raw);
    });

    async function handleMessage(raw: Buffer) {
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "location_ping" && payload.actorType === "PILOT") {
        await handleLocationPing(app, payload.sub, msg);
        return;
      }

      if (msg.type === "subscribe_zone" && payload.actorType === "ADMIN" && typeof msg.zoneId === "string") {
        const channel = `zone:${msg.zoneId}:locations`;
        await app.realtime.subscribeSocket(channel, socket);
        subscribedChannels.add(channel);
        return;
      }

      if (msg.type === "subscribe_order" && typeof msg.orderId === "string") {
        const orderId = msg.orderId;
        const allowed = await canSubscribeToOrder(app, payload, orderId);
        if (!allowed) return;

        const channel = `order:${orderId}:updates`;
        await app.realtime.subscribeSocket(channel, socket);
        subscribedChannels.add(channel);
        return;
      }
    }

    socket.on("close", () => {
      void app.realtime.removeSocketFromAllChannels(socket);
    });
  });
}

async function canSubscribeToOrder(app: FastifyInstance, payload: JwtPayload, orderId: string): Promise<boolean> {
  if (payload.actorType === "ADMIN") return true;

  const order = await app.prisma.order.findUnique({
    where: { id: orderId },
    include: { shipments: true },
  });
  if (!order) return false;

  if (payload.actorType === "CUSTOMER") return order.userId === payload.sub;

  if (payload.actorType === "PILOT") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return order.shipments.some((s: any) => s.pilotId === payload.sub);
  }

  return false;
}

async function handleLocationPing(app: FastifyInstance, pilotId: string, msg: IncomingMessage) {
  const lat = msg.lat;
  const lng = msg.lng;
  const heading = typeof msg.heading === "number" ? msg.heading : null;
  const speedKph = typeof msg.speedKph === "number" ? msg.speedKph : null;

  if (typeof lat !== "number" || typeof lng !== "number") return;

  const shift = await app.prisma.shift.findFirst({ where: { pilotId, status: "IN_PROGRESS" } });

  await app.prisma.$executeRaw`
    INSERT INTO "PilotLiveLocation" ("pilotId", location, heading, "speedKph", "shiftId", "recordedAt")
    VALUES (${pilotId}, ST_SetSRID(ST_Point(${lng}, ${lat}), 4326), ${heading}, ${speedKph}, ${shift?.id ?? null}, now())
    ON CONFLICT ("pilotId") DO UPDATE SET
      location = EXCLUDED.location,
      heading = EXCLUDED.heading,
      "speedKph" = EXCLUDED."speedKph",
      "shiftId" = EXCLUDED."shiftId",
      "recordedAt" = EXCLUDED."recordedAt"
  `;

  const now = Date.now();
  const last = lastPersistedAt.get(pilotId) ?? 0;
  if (now - last >= LOCATION_HISTORY_THROTTLE_MS) {
    lastPersistedAt.set(pilotId, now);
    await app.prisma.$executeRaw`
      INSERT INTO "PilotLocationPing" (id, "pilotId", location, heading, "speedKph", "recordedAt")
      VALUES (${randomUUID()}, ${pilotId}, ST_SetSRID(ST_Point(${lng}, ${lat}), 4326), ${heading}, ${speedKph}, now())
    `;
  }

  if (shift?.zoneId) {
    await app.realtime.publish(`zone:${shift.zoneId}:locations`, {
      type: "pilot_location",
      pilotId,
      lat,
      lng,
      heading,
      speedKph,
      recordedAt: new Date().toISOString(),
    });
  }
}