import type { FastifyInstance } from "fastify";
import { CustomersService } from "./customers.service.js";
import { listCustomersQuerySchema, updateMyCustomerProfileSchema } from "./customers.schemas.js";
import { requirePermission, requireActor } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";


export async function customersRoutes(app: FastifyInstance) {
  const customersService = new CustomersService(app);

  app.get("/", { preHandler: requirePermission(PERMISSIONS.CUSTOMERS_READ) }, async (request, reply) => {
    const parsed = listCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new BadRequestError("Invalid query", parsed.error.flatten());
    return reply.send(await customersService.listCustomers(parsed.data));
  });

  app.get("/:id", { preHandler: requirePermission(PERMISSIONS.CUSTOMERS_READ) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await customersService.getCustomerById(id));
  });

  app.get("/me", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    return reply.send(await customersService.getMyProfile(request.user.sub));
  });

  app.patch("/me", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const parsed = updateMyCustomerProfileSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.send(await customersService.updateMyProfile(request.user.sub, parsed.data));
  });
}