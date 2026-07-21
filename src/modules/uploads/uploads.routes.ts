import type { FastifyInstance } from "fastify";
import { UploadsService } from "./uploads.service.js";
import { presignUploadSchema } from "./uploads.schemas.js";
import { requireActor } from "../auth/rbac.middleware.js";
import { BadRequestError } from "../../lib/errors.js";

export async function uploadsRoutes(app: FastifyInstance) {
  const uploadsService = new UploadsService(app);

  app.post("/presign", { preHandler: requireActor("PILOT", "CUSTOMER") }, async (request, reply) => {
    const parsed = presignUploadSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());

    const result = await uploadsService.createPresignedUpload(request.user.actorType, request.user.sub, parsed.data);
    return reply.send(result);
  });
}