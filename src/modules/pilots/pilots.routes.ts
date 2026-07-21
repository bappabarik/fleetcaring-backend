import type { FastifyInstance } from "fastify";
import { PilotsService } from "./pilots.service.js";
import {
  createPilotSchema,
  updatePilotSchema,
  updateMyPilotPreferencesSchema,
  listPilotsQuerySchema,
} from "./pilots.schemas.js";
import { requirePermission, requireActor } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function pilotsRoutes(app: FastifyInstance) {
  const pilotsService = new PilotsService(app);

  app.get("/me", { preHandler: requireActor("PILOT") }, async (request, reply) => {
    return reply.send(await pilotsService.getMyProfile(request.user.sub));
  });

  app.patch("/me", { preHandler: requireActor("PILOT") }, async (request, reply) => {
    const parsed = updateMyPilotPreferencesSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.send(await pilotsService.updateMyPreferences(request.user.sub, parsed.data));
  });

  app.get("/", { preHandler: requirePermission(PERMISSIONS.PILOTS_READ) }, async (request, reply) => {
    const parsed = listPilotsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new BadRequestError("Invalid query", parsed.error.flatten());
    return reply.send(await pilotsService.listPilots(parsed.data));
  });

  app.get("/:id", { preHandler: requirePermission(PERMISSIONS.PILOTS_READ) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await pilotsService.getPilotById(id));
  });

  app.post("/", { preHandler: requirePermission(PERMISSIONS.PILOTS_WRITE) }, async (request, reply) => {
    const parsed = createPilotSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await pilotsService.createPilot(parsed.data));
  });

  app.patch("/:id", { preHandler: requirePermission(PERMISSIONS.PILOTS_WRITE) }, async (request, reply) => {
    const parsed = updatePilotSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await pilotsService.updatePilot(id, parsed.data));
  });
}