import type { FastifyInstance } from "fastify";
import { PaymentsService } from "./payments.service.js";
import { requireActor, requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";

export async function paymentsRoutes(app: FastifyInstance) {
  const paymentsService = new PaymentsService(app);

  app.post("/:orderId/intent", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    return reply.send(await paymentsService.createPaymentIntent(orderId, request.user.sub));
  });

  app.get("/:orderId", { preHandler: requireActor("CUSTOMER", "ADMIN") }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const requestingUserId = request.user.actorType === "CUSTOMER" ? request.user.sub : undefined;
    return reply.send(await paymentsService.getPaymentForOrder(orderId, requestingUserId));
  });

  app.post(
    "/:orderId/refund",
    { preHandler: requirePermission(PERMISSIONS.FINANCE_REFUND) },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      return reply.send(await paymentsService.refundPayment(orderId));
    }
  );
}