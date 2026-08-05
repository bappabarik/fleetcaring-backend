import type { FastifyInstance } from "fastify";
import { PromoCodesService } from "./promo-codes.service.js";
import {
  createPromoCodeSchema,
  updatePromoCodeSchema,
  validatePromoCodeSchema,
  listPromoCodesQuerySchema,
} from "./promo-codes.schemas.js";
import { requireActor, requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function promoCodesRoutes(app: FastifyInstance) {
  const promoCodesService = new PromoCodesService(app);

  app.get("/", { preHandler: requirePermission(PERMISSIONS.CATALOG_READ) }, async (request, reply) => {
    const parsed = listPromoCodesQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new BadRequestError("Invalid query", parsed.error.flatten());
    return reply.send(await promoCodesService.listPromoCodes(parsed.data));
  });

  app.post("/", { preHandler: requirePermission(PERMISSIONS.CATALOG_WRITE) }, async (request, reply) => {
    const parsed = createPromoCodeSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await promoCodesService.createPromoCode(parsed.data));
  });

  app.patch("/:id", { preHandler: requirePermission(PERMISSIONS.CATALOG_WRITE) }, async (request, reply) => {
    const parsed = updatePromoCodeSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await promoCodesService.updatePromoCode(id, parsed.data));
  });

  app.get(
    "/:id/redemptions",
    { preHandler: requirePermission(PERMISSIONS.CATALOG_READ) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await promoCodesService.getRedemptions(id));
    }
  );

  app.post("/validate", { preHandler: requireActor("CUSTOMER") }, async (request, reply) => {
    const parsed = validatePromoCodeSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const result = await promoCodesService.validatePromoCode(
      parsed.data.code,
      request.user.sub,
      parsed.data.orderSubtotal
    );
    return reply.send(result);
  });
}