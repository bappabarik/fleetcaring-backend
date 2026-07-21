import type { FastifyInstance } from "fastify";
import { VehiclesService } from "./vehicles.service.js";
import { createVehicleSchema, updateVehicleSchema } from "./vehicles.schemas.js";
import { requireActor } from "../auth/rbac.middleware.js";
import { BadRequestError } from "../../lib/errors.js";

export async function vehiclesRoutes(app: FastifyInstance) {
  const vehiclesService = new VehiclesService(app);

  app.get("/", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    return reply.send(await vehiclesService.listMyVehicles(request.user.sub));
  });

  app.post("/", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const parsed = createVehicleSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await vehiclesService.createVehicle(request.user.sub, parsed.data));
  });

  app.patch("/:id", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const parsed = updateVehicleSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await vehiclesService.updateVehicle(id, request.user.sub, parsed.data));
  });

  app.delete("/:id", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await vehiclesService.deleteVehicle(id, request.user.sub);
    return reply.status(204).send();
  });
}