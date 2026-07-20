import type { FastifyInstance } from "fastify";
import { AssetsService } from "./assets.service.js";
import { createAssetSchema, updateAssetSchema } from "./assets.schemas.js";
import { requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function assetsRoutes(app: FastifyInstance) {
  const assetsService = new AssetsService(app);

  app.get("/", { preHandler: requirePermission(PERMISSIONS.ASSETS_READ) }, async (_request, reply) => {
    return reply.send(await assetsService.listAssets());
  });

  app.post("/", { preHandler: requirePermission(PERMISSIONS.ASSETS_WRITE) }, async (request, reply) => {
    const parsed = createAssetSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await assetsService.createAsset(parsed.data));
  });

  app.patch("/:id", { preHandler: requirePermission(PERMISSIONS.ASSETS_WRITE) }, async (request, reply) => {
    const parsed = updateAssetSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await assetsService.updateAsset(id, parsed.data));
  });
}