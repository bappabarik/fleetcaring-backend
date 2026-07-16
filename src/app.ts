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
  // await app.register(zonesModule, { prefix: "/zones" });
  // ...more modules land here as they're built

  return app;
}
