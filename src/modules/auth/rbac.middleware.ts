import type { FastifyRequest, FastifyReply } from "fastify";
import type { ActorType } from "../../types/auth.js";

/**
 * Verifies the JWT and ensures the caller is one of the allowed actor
 * types. A customer's token can never satisfy a pilot-only or admin-only
 * route, even with a technically valid signature — the check happens here,
 * before any route handler runs, not left to convention.
 */
export function requireActor(...allowed: ActorType[]) {
  return async function requireActorHandler(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "UNAUTHORIZED", message: "Invalid or missing token" });
    }

    if (!allowed.includes(request.user.actorType)) {
      return reply
        .status(403)
        .send({ error: "FORBIDDEN", message: "This action is not available for your account type" });
    }
  };
}

/**
 * Admin-only. Checks the permission keys embedded in the admin's JWT at
 * login/refresh time (not a fresh DB lookup per request — keeps this
 * cheap). "*" in the permissions list means super-admin, matching every key.
 */
export function requirePermission(key: string) {
  return async function requirePermissionHandler(request: FastifyRequest, reply: FastifyReply) {
    await requireActor("ADMIN")(request, reply);
    if (reply.sent) return;

    const permissions = request.user.permissions ?? [];
    if (!permissions.includes("*") && !permissions.includes(key)) {
      return reply
        .status(403)
        .send({ error: "FORBIDDEN", message: `Missing required permission: ${key}` });
    }
  };
}
