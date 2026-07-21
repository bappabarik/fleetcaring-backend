import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

/**
 * Global capture hook: whenever idempotent() (see idempotency.ts) has
 * tagged a request with an Idempotency-Key AND the route succeeded (2xx),
 * store the response so a retry with the same key replays it verbatim
 * instead of re-running the action. Registered once, applies to every
 * route — routes opt in by adding idempotent() to their preHandler array.
 */
export default fp(async function idempotencyPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("idempotencyKey", undefined);

  fastify.addHook("onSend", async (request, reply, payload) => {
    if (!request.idempotencyKey) return payload;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;
    if (!request.user) return payload;

    let parsedBody: unknown;
    try {
      parsedBody = typeof payload === "string" ? JSON.parse(payload) : payload;
    } catch {
      return payload; // not JSON — nothing sensible to cache
    }

    // Best-effort: if this races with a concurrent identical request and
    // both try to insert, the unique constraint on (actorType, actorId, id)
    // means one wins and one fails — that's fine, correctness doesn't
    // depend on which one does.
    await fastify.prisma.idempotencyRecord
      .create({
        data: {
          id: request.idempotencyKey,
          actorType: request.user.actorType,
          actorId: request.user.sub,
          endpoint: request.routeOptions?.url ?? request.url,
          statusCode: reply.statusCode,
          responseBody: parsedBody as never,
        },
      })
      .catch(() => {});

    return payload;
  });
});