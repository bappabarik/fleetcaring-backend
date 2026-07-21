import type { FastifyInstance } from "fastify";
import { DevicesService } from "./devices.service.js";
import { registerDeviceTokenSchema } from "./devices.schemas.js";
import { requireActor } from "../auth/rbac.middleware.js";
import { BadRequestError } from "../../lib/errors.js";

export async function devicesRoutes(app: FastifyInstance) {
  const devicesService = new DevicesService(app);

  app.post("/register", { preHandler: requireActor("CUSTOMER", "PILOT") }, async (request, reply) => {
    const parsed = registerDeviceTokenSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());

    const result = await devicesService.registerDeviceToken(request.user.actorType, request.user.sub, parsed.data);
    return reply.status(201).send(result);
  });

  app.delete("/:token", { preHandler: requireActor("CUSTOMER", "PILOT") }, async (request, reply) => {
    const { token } = request.params as { token: string };
    await devicesService.unregisterDeviceToken(request.user.actorType, request.user.sub, token);
    return reply.status(204).send();
  });
}