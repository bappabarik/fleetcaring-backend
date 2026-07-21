import type { FastifyInstance } from "fastify";
import { IssuesService } from "./issues.service.js";
import { listIssuesQuerySchema, resolveIssueSchema } from "./issues.schemas.js";
import { requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function issuesRoutes(app: FastifyInstance) {
  const issuesService = new IssuesService(app);

  app.get("/", { preHandler: requirePermission(PERMISSIONS.ISSUES_READ) }, async (request, reply) => {
    const parsed = listIssuesQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new BadRequestError("Invalid query", parsed.error.flatten());
    return reply.send(await issuesService.listIssues(parsed.data));
  });

  app.patch("/:id/resolve", { preHandler: requirePermission(PERMISSIONS.ISSUES_WRITE) }, async (request, reply) => {
    const parsed = resolveIssueSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new BadRequestError("Invalid payload", parsed.error.flatten());
    const { id } = request.params as { id: string };
    return reply.send(await issuesService.resolveIssue(id, request.user.sub, parsed.data));
  });
}