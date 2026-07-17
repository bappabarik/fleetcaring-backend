import type { FastifyInstance } from "fastify";
import { ZonesService } from "./zones.service.js";
import { createZoneSchema, updateZoneSchema, resolveZoneQuerySchema } from "./zones.schemas.js";
import { requirePermission, requireActor } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function zonesRoutes(app: FastifyInstance) {
  const zonesService = new ZonesService(app);

  app.get("/", { preHandler: requirePermission(PERMISSIONS.ZONES_READ) }, async (_request, reply) => {
    return reply.send(await zonesService.listZones());
  });

  app.get("/:id", { preHandler: requirePermission(PERMISSIONS.ZONES_READ) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await zonesService.getZoneById(id));
  });

  app.post("/", { preHandler: requirePermission(PERMISSIONS.ZONES_WRITE) }, async (request, reply) => {
    const parsed = createZoneSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid zone payload", parsed.error.flatten());
    const zone = await zonesService.createZone(parsed.data.code, parsed.data.name, parsed.data.boundary);
    return reply.status(201).send(zone);
  });

  app.patch("/:id", { preHandler: requirePermission(PERMISSIONS.ZONES_WRITE) }, async (request, reply) => {
    const parsed = updateZoneSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid update payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await zonesService.updateZone(id, parsed.data));
  });

  app.get(
    "/resolve",
    { preHandler: requireActor("CUSTOMER", "PILOT", "ADMIN") },
    async (request, reply) => {
      const parsed = resolveZoneQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new BadRequestError("Invalid coordinates", parsed.error.flatten());
      const zone = await zonesService.resolveZoneForPoint(parsed.data.lat, parsed.data.lng);
      return reply.send({ zone });
    }
  );
}