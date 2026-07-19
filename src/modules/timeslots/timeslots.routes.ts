import type { FastifyInstance } from "fastify";
import { TimeslotsService } from "./timeslots.service.js";
import {
  createTemplateSchema,
  updateTemplateSchema,
  listTimeslotsQuerySchema,
  bookSlotSchema,
} from "./timeslots.schemas.js";
import { requirePermission, requireActor } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function timeslotsRoutes(app: FastifyInstance) {
  const timeslotsService = new TimeslotsService(app);

  app.get(
    "/templates",
    { preHandler: requirePermission(PERMISSIONS.TIMESLOTS_READ) },
    async (_request, reply) => reply.send(await timeslotsService.listTemplates())
  );

  app.post(
    "/templates",
    { preHandler: requirePermission(PERMISSIONS.TIMESLOTS_WRITE) },
    async (request, reply) => {
      const parsed = createTemplateSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid template payload", parsed.error.flatten());
      const result = await timeslotsService.createTemplate(parsed.data);
      return reply.status(201).send(result);
    }
  );

  app.patch(
    "/templates/:id",
    { preHandler: requirePermission(PERMISSIONS.TIMESLOTS_WRITE) },
    async (request, reply) => {
      const parsed = updateTemplateSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid update payload", parsed.error.flatten());
      const { id } = request.params as { id: string };
      return reply.send(await timeslotsService.updateTemplate(id, parsed.data));
    }
  );

  app.post(
    "/templates/:id/materialize",
    { preHandler: requirePermission(PERMISSIONS.TIMESLOTS_WRITE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await timeslotsService.materializeTemplate(id));
    }
  );

  app.get(
    "/",
    { preHandler: requireActor("CUSTOMER", "PILOT", "ADMIN") },
    async (request, reply) => {
      const parsed = listTimeslotsQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new BadRequestError("Invalid query", parsed.error.flatten());
      const slots = await timeslotsService.listAvailableSlots(parsed.data.opItemId, parsed.data.zoneId, parsed.data.date);
      return reply.send(slots);
    }
  );

  app.post(
    "/book",
    { preHandler: requireActor("CUSTOMER", "ADMIN") },
    async (request, reply) => {
      const parsed = bookSlotSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid request", parsed.error.flatten());
      await timeslotsService.bookSlot(parsed.data.timeslotId, request.user.sub);
      return reply.send({ status: "booked" });
    }
  );

  app.get(
    "/:id/log",
    { preHandler: requirePermission(PERMISSIONS.TIMESLOTS_READ) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await timeslotsService.getCapacityLog(id));
    }
  );
}