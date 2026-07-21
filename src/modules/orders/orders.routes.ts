import type { FastifyInstance } from "fastify";
import { OrdersService } from "./orders.service.js";
import { ShipmentsService } from "../shipments/shipments.service.js";
import { createOrderSchema } from "./orders.schemas.js";
import { raiseIssueSchema } from "../shipments/shipments.schemas.js";
import { requireActor } from "../auth/rbac.middleware.js";
import { BadRequestError } from "../../lib/errors.js";
import { idempotent } from "../../lib/idempotency.js";

export async function ordersRoutes(app: FastifyInstance) {
  const ordersService = new OrdersService(app);
  const shipmentsService = new ShipmentsService(app);

  app.post("/", { preHandler: [requireActor("CUSTOMER"), idempotent()] }, async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid order payload", parsed.error.flatten());

    const order = await ordersService.createOrder(request.user.sub, parsed.data);
    return reply.status(201).send(order);
  });

  app.get("/", { preHandler: requireActor("CUSTOMER", "ADMIN") }, async (request, reply) => {
    if (request.user.actorType === "ADMIN") {
      return reply.send(await ordersService.listAllOrders());
    }
    return reply.send(await ordersService.listOrdersForUser(request.user.sub));
  });

  app.get("/:id", { preHandler: requireActor("CUSTOMER", "PILOT", "ADMIN") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const requestingUserId = request.user.actorType === "CUSTOMER" ? request.user.sub : undefined;
    return reply.send(await ordersService.getOrderById(id, requestingUserId));
  });

  // ---------- Pilot order-level actions ----------

  app.post("/:id/enroute", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await ordersService.markEnroute(id, request.user.sub));
  });

  app.post("/:id/confirm-arrival", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await ordersService.confirmArrival(id, request.user.sub));
  });

  app.post("/:id/complete", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await ordersService.completeOrder(id, request.user.sub));
  });

  app.post("/:id/issues", { preHandler: [requireActor("PILOT"), idempotent()] }, async (request, reply) => {
    const parsed = raiseIssueSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.status(201).send(await shipmentsService.raiseIssue(id, request.user.sub, parsed.data));
  });
}