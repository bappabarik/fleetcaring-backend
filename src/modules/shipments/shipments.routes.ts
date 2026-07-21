import type { FastifyInstance } from "fastify";
import { ShipmentsService } from "./shipments.service.js";
import { assignShipmentSchema, checkSubmissionSchema, listMyShipmentsQuerySchema } from "./shipments.schemas.js";
import { requireActor, requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";
import { idempotent } from "../../lib/idempotency.js";

export async function shipmentsRoutes(app: FastifyInstance) {
  const shipmentsService = new ShipmentsService(app);

  app.get("/mine", { preHandler: requireActor("PILOT") }, async (request, reply) => {
    const parsed = listMyShipmentsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new BadRequestError("Invalid query", parsed.error.flatten());

    const statuses = parsed.data.status
      ? parsed.data.status.split(",").map((s) => s.trim())
      : undefined;

    const result = await shipmentsService.listMyShipments(request.user.sub, {
      date: parsed.data.date,
      statuses,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });

    return reply.send(result);
  });

  app.post(
    "/:id/assign",
    { preHandler: requirePermission(PERMISSIONS.SHIPMENTS_WRITE) },
    async (request, reply) => {
      const parsed = assignShipmentSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
      const { id } = request.params as { id: string };
      return reply.send(await shipmentsService.assign(id, parsed.data, request.user.sub));
    }
  );

  app.post("/:id/pre-check", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const parsed = checkSubmissionSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await shipmentsService.submitPreCheck(id, request.user.sub, parsed.data));
  });

  app.post("/:id/post-check", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const parsed = checkSubmissionSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await shipmentsService.submitPostCheck(id, request.user.sub, parsed.data));
  });
}