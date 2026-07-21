import type { FastifyInstance } from "fastify";
import { ShiftsService } from "./shifts.service.js";
import { createShiftSchema, startBreakSchema } from "./shifts.schemas.js";
import { requireActor, requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError, ForbiddenError } from "../../lib/errors.js";
import { idempotent } from "../../lib/idempotency.js";

export async function shiftsRoutes(app: FastifyInstance) {
  const shiftsService = new ShiftsService(app);

  app.get("/", { preHandler: requirePermission(PERMISSIONS.SHIFTS_READ) }, async (request, reply) => {
    const { pilotId } = request.query as { pilotId?: string };
    return reply.send(await shiftsService.listShifts(pilotId));
  });

  app.post("/", { preHandler: requirePermission(PERMISSIONS.SHIFTS_WRITE) }, async (request, reply) => {
    const parsed = createShiftSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await shiftsService.createShift(parsed.data));
  });

  app.get("/:id", { preHandler: requireActor("PILOT", "ADMIN") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const shift = await shiftsService.getShiftById(id);
    if (request.user.actorType === "PILOT" && shift.pilotId !== request.user.sub) {
      throw new ForbiddenError("Not your shift");
    }
    return reply.send(shift);
  });

  app.get("/me/dashboard", { preHandler: requireActor("PILOT") }, async (request, reply) => {
    return reply.send(await shiftsService.getPilotDashboard(request.user.sub));
  });

  app.get("/me/list", { preHandler: requireActor("PILOT") }, async (request, reply) => {
    return reply.send(await shiftsService.listShifts(request.user.sub));
  });

  app.post("/:id/start", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await shiftsService.startShift(id, request.user.sub));
  });

  app.post("/:id/end", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await shiftsService.endShift(id, request.user.sub));
  });

  app.post("/:id/breaks", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const parsed = startBreakSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.status(201).send(await shiftsService.startBreak(id, request.user.sub, parsed.data));
  });

  app.post("/:id/breaks/:breakId/end", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const { id, breakId } = request.params as { id: string; breakId: string };
    return reply.send(await shiftsService.endBreak(id, breakId, request.user.sub));
  });
}