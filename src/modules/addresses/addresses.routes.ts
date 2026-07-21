import type { FastifyInstance } from "fastify";
import { AddressesService } from "./addresses.service.js";
import { createAddressSchema, updateAddressSchema } from "./addresses.schemas.js";
import { requireActor } from "../auth/rbac.middleware.js";
import { BadRequestError } from "../../lib/errors.js";

export async function addressesRoutes(app: FastifyInstance) {
  const addressesService = new AddressesService(app);

  app.get("/service-availability", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    return reply.send(await addressesService.checkServiceAvailability(request.user.sub));
  });

  app.get("/", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    return reply.send(await addressesService.listMyAddresses(request.user.sub));
  });

  app.post("/", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const parsed = createAddressSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await addressesService.createAddress(request.user.sub, parsed.data));
  });

  app.patch("/:id", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const parsed = updateAddressSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await addressesService.updateAddress(id, request.user.sub, parsed.data));
  });

  app.delete("/:id", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await addressesService.deleteAddress(id, request.user.sub);
    return reply.status(204).send();
  });
}