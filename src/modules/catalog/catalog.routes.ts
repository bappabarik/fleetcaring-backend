import type { FastifyInstance } from "fastify";
import { CatalogService } from "./catalog.service.js";
import {
  createVerticalSchema,
  createBrandSchema,
  createOpItemSchema,
  updateOpItemSchema,
  createVariationSchema,
  updateVariationSchema,
  createPriceRuleSchema,
  resolvePriceQuerySchema,
} from "./catalog.schemas.js";
import { requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function catalogRoutes(app: FastifyInstance) {
  const catalogService = new CatalogService(app);

  app.get("/verticals", async (_request, reply) => {
    return reply.send(await catalogService.listVerticals());
  });

  app.get("/verticals/:id/items", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await catalogService.listActiveItemsForVertical(id));
  });

  app.get("/variations/:id/price", async (request, reply) => {
    const parsed = resolvePriceQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new BadRequestError("Invalid query", parsed.error.flatten());
    const { id } = request.params as { id: string };
    const priceAED = await catalogService.resolveEffectivePrice(id, parsed.data.zoneId ?? null);
    return reply.send({ priceAED });
  });

  app.post("/verticals", { preHandler: requirePermission(PERMISSIONS.CATALOG_WRITE) }, async (request, reply) => {
    const parsed = createVerticalSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await catalogService.createVertical(parsed.data.name));
  });

  app.post("/brands", { preHandler: requirePermission(PERMISSIONS.CATALOG_WRITE) }, async (request, reply) => {
    const parsed = createBrandSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await catalogService.createBrand(parsed.data.name));
  });

  app.post("/op-items", { preHandler: requirePermission(PERMISSIONS.CATALOG_WRITE) }, async (request, reply) => {
    const parsed = createOpItemSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await catalogService.createOpItem(parsed.data));
  });

  app.patch(
    "/op-items/:id",
    { preHandler: requirePermission(PERMISSIONS.CATALOG_WRITE) },
    async (request, reply) => {
      const parsed = updateOpItemSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
      const { id } = request.params as { id: string };
      return reply.send(await catalogService.updateOpItem(id, parsed.data));
    }
  );

  app.post(
    "/op-items/:id/variations",
    { preHandler: requirePermission(PERMISSIONS.CATALOG_WRITE) },
    async (request, reply) => {
      const parsed = createVariationSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
      const { id } = request.params as { id: string };
      return reply.status(201).send(await catalogService.createVariation(id, parsed.data));
    }
  );

  app.patch(
    "/variations/:id",
    { preHandler: requirePermission(PERMISSIONS.CATALOG_WRITE) },
    async (request, reply) => {
      const parsed = updateVariationSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
      const { id } = request.params as { id: string };
      return reply.send(await catalogService.updateVariation(id, parsed.data));
    }
  );

  app.post(
    "/variations/:id/price-rules",
    { preHandler: requirePermission(PERMISSIONS.PRICING_WRITE) },
    async (request, reply) => {
      const parsed = createPriceRuleSchema.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
      const { id } = request.params as { id: string };
      return reply.status(201).send(await catalogService.createPriceRule(id, parsed.data));
    }
  );
}