import type { FastifyRequest, FastifyReply } from "fastify";

const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * Add to a route's preHandler array AFTER requireActor/requirePermission
 * (it needs request.user to already be populated). If the client sends an
 * Idempotency-Key header and we've already processed this exact
 * (actorType, actorId, key) before, replays the stored response verbatim
 * instead of re-running the route — this is what makes "pilot's
 * connection drops mid-response, app retries the same action" safe by
 * construction, not by convention.
 *
 * If no header is sent, this is a complete no-op — routes behave exactly
 * as before for callers that don't opt in.
 */
export function idempotent() {
  return async function idempotencyPreHandler(request: FastifyRequest, reply: FastifyReply) {
    const key = request.headers[IDEMPOTENCY_HEADER];
    if (!key || typeof key !== "string") return;
    if (!request.user) return; // auth preHandler should run first; nothing to key on otherwise

    const existing = await request.server.prisma.idempotencyRecord.findUnique({
      where: {
        actorType_actorId_id: {
          actorType: request.user.actorType,
          actorId: request.user.sub,
          id: key,
        },
      },
    });

    if (existing) {
      reply.status(200).send(existing.responseBody);
      return reply;
    }

    // Tag the request so the global onSend hook (idempotency plugin) knows
    // to record this response once the route finishes successfully.
    request.idempotencyKey = key;
  };
}