import type { FastifyInstance } from "fastify";
import { AdminUsersService } from "./admin-users.service.js";
import { createAdminUserSchema, updateAdminUserSchema } from "./admin-users.schemas.js";
import { requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function adminUsersRoutes(app: FastifyInstance) {
  const adminUsersService = new AdminUsersService(app);

  app.get("/roles", { preHandler: requirePermission(PERMISSIONS.SUPER_ADMIN_ONLY) }, async (_request, reply) => {
    return reply.send(await adminUsersService.listRoles());
  });

  app.get("/", { preHandler: requirePermission(PERMISSIONS.SUPER_ADMIN_ONLY) }, async (_request, reply) => {
    return reply.send(await adminUsersService.listAdminUsers());
  });

  app.post("/", { preHandler: requirePermission(PERMISSIONS.SUPER_ADMIN_ONLY) }, async (request, reply) => {
    const parsed = createAdminUserSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    return reply.status(201).send(await adminUsersService.createAdminUser(parsed.data));
  });

  app.patch("/:id", { preHandler: requirePermission(PERMISSIONS.SUPER_ADMIN_ONLY) }, async (request, reply) => {
    const parsed = updateAdminUserSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await adminUsersService.updateAdminUser(id, parsed.data, request.user.sub));
  });
}