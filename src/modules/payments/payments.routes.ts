import type { FastifyInstance } from "fastify";
import { PaymentsService } from "./payments.service.js";
import { requireActor, requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { idempotent } from "../../lib/idempotency.js";
import { BadRequestError } from "../../lib/errors.js";
import { createIntentSchema, setCodCollectedSchema } from "./payments.schemas.js";

export async function paymentsRoutes(app: FastifyInstance) {
  const paymentsService = new PaymentsService(app);

  app.post("/:orderId/intent", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const parsed = createIntentSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.send(await paymentsService.createPaymentIntent(orderId, request.user.sub, parsed.data.method));
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

  // The pilot who's assigned to this order confirms they collected the cash,
  // typically fired alongside completing the order — same idempotency-key
  // convention as orders.routes.ts's enroute/confirm-arrival/complete.
  app.post(
    "/:orderId/cod/collect",
    { preHandler: [requireActor("PILOT"), idempotent()] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      return reply.send(await paymentsService.collectCodAsPilot(orderId, request.user.sub));
    }
  );

  // Admin correction — mark a COD payment collected/uncollected regardless
  // of pilot assignment, same permission tier as issuing a refund.
  app.patch(
    "/:orderId/cod",
    { preHandler: requirePermission(PERMISSIONS.FINANCE_REFUND) },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const parsed = setCodCollectedSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
      return reply.send(await paymentsService.setCodCollected(orderId, parsed.data.collected));
    }
  );
}
