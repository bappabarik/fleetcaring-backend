import type { FastifyInstance } from "fastify";
import { FinanceService } from "./finance.service.js";
import { financeReportQuerySchema } from "./finance.schemas.js";
import { requirePermission } from "../auth/rbac.middleware.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export async function financeRoutes(app: FastifyInstance) {
  const financeService = new FinanceService(app);

  app.get("/reports", { preHandler: requirePermission(PERMISSIONS.FINANCE_REPORTS) }, async (request, reply) => {
    const parsed = financeReportQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new BadRequestError("Invalid query", parsed.error.flatten());
    return reply.send(await financeService.getReport(parsed.data));
  });
}