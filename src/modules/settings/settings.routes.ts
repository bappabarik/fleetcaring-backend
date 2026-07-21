import type { FastifyInstance } from "fastify";
import { isGeofencingEnabled, setGeofencingEnabled } from "../../lib/settings.js";
import { setGeofencingSchema } from "./settings.schemas.js";
import { requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/geofencing", { preHandler: requirePermission(PERMISSIONS.SETTINGS_READ) }, async (_request, reply) => {
    return reply.send({ enabled: await isGeofencingEnabled(app.prisma) });
  });

  app.patch("/geofencing", { preHandler: requirePermission(PERMISSIONS.SETTINGS_WRITE) }, async (request, reply) => {
    const parsed = setGeofencingSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());

    await setGeofencingEnabled(app.prisma, parsed.data.enabled);
    return reply.send({ enabled: parsed.data.enabled });
  });
}