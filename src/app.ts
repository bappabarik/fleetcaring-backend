import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import jwt from "@fastify/jwt";
import { env } from "./config/env.js";
import prismaPlugin from "./plugins/prisma.js";
import redisPlugin from "./plugins/redis.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { AppError } from "./lib/errors.js";
import { zonesRoutes } from "./modules/zones/zones.routes.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import { timeslotsRoutes } from "./modules/timeslots/timeslots.routes.js";
import { ordersRoutes } from "./modules/orders/orders.routes.js";
import { shipmentsRoutes } from "./modules/shipments/shipments.routes.js";
import { assetsRoutes } from "./modules/assets/assets.routes.js";
import { pilotsRoutes } from "./modules/pilots/pilots.routes.js";
import { shiftsRoutes } from "./modules/shifts/shifts.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { paymentsWebhookRoutes } from "./modules/payments/payments.webhook.routes.js";
import realtimePlugin from "./plugins/realtime.js";
import { realtimeRoutes } from "./modules/realtime/realtime.routes.js";
import idempotencyPlugin from "./plugins/idempotency.js";
import { uploadsRoutes } from "./modules/uploads/uploads.routes.js";
import { devicesRoutes } from "./modules/devices/devices.routes.js";
import { vehiclesRoutes } from "./modules/vehicles/vehicles.routes.js";
import { addressesRoutes } from "./modules/addresses/addresses.routes.js";
import { settingsRoutes } from "./modules/settings/settings.routes.js";



export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport: env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
    },
  });

  // --- Central error handler: typed AppError subclasses map to their own
  // status code + machine-readable error code; anything else is logged and
  // returned as an opaque 500 (never leak internal error details). ---
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const details = "details" in error ? (error as AppError & { details?: unknown }).details : undefined;
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(details !== undefined ? { details } : {}),
      });
    }

    // Fastify's own validation errors (e.g. from schema-based routes) carry a statusCode already.
    const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof maybeStatusCode === "number" && maybeStatusCode < 500) {
      const message = error instanceof Error ? error.message : "Invalid request";
      return reply.status(maybeStatusCode).send({ error: "BAD_REQUEST", message });
    }

    request.log.error(error, "Unhandled error");
    return reply.status(500).send({ error: "INTERNAL_ERROR", message: "Something went wrong" });
  });

  // --- Security & platform plugins ---
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",") });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(websocket);
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });

  // --- Infra plugins ---
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(realtimePlugin);
  await app.register(idempotencyPlugin);

  // --- Health check ---
  app.get("/health", async () => {
    return { status: "ok", env: env.NODE_ENV, timestamp: new Date().toISOString() };
  });

  app.get("/health/deep", async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      const redisPing = await app.redis.ping();
      return { status: "ok", database: "connected", redis: redisPing === "PONG" ? "connected" : "unknown" };
    } catch (err) {
      app.log.error(err, "Deep health check failed");
      return reply.status(503).send({ status: "error", message: "Dependency check failed" });
    }
  });

  // --- Feature modules ---
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(zonesRoutes, { prefix: "/zones" });
  await app.register(catalogRoutes, { prefix: "/catalog" });
  await app.register(timeslotsRoutes, { prefix: "/timeslots" });
  await app.register(ordersRoutes, { prefix: "/orders" });
  await app.register(shipmentsRoutes, { prefix: "/shipments" });
  await app.register(assetsRoutes, { prefix: "/assets" });
  await app.register(pilotsRoutes, { prefix: "/pilots" });
  await app.register(shiftsRoutes, { prefix: "/shifts" });
  await app.register(paymentsRoutes, { prefix: "/payments" });
  await app.register(paymentsWebhookRoutes, { prefix: "/payments" });
  await app.register(realtimeRoutes, { prefix: "/realtime" });
  await app.register(uploadsRoutes, { prefix: "/uploads" });
  await app.register(devicesRoutes, { prefix: "/devices" });
  await app.register(vehiclesRoutes, { prefix: "/vehicles" });
  await app.register(addressesRoutes, { prefix: "/addresses" });
  await app.register(settingsRoutes, { prefix: "/settings" });
  // ...more modules land here as they're built

  return app;
}
