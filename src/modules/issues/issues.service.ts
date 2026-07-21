import type { FastifyInstance } from "fastify";
import { NotFoundError, ConflictError, ForbiddenError } from "../../lib/errors.js";
import type { ListIssuesQuery, ResolveIssueBody } from "./issues.schemas.js";

export class IssuesService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async listIssues(filters: ListIssuesQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.resolved === "true") where.resolvedAt = { not: null };
    if (filters.resolved === "false") where.resolvedAt = null;
    if (filters.reason) where.reason = filters.reason;
    if (filters.zoneId) where.order = { address: { zoneId: filters.zoneId } };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
      if (filters.dateTo) where.createdAt.lte = filters.dateTo;
    }

    const issues = await this.prisma.issue.findMany({
      where,
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        order: { include: { user: true, address: { include: { zone: true } } } },
        shipment: true,
        raisedBy: { select: { id: true, firstName: true, lastName: true, code: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const hasMore = issues.length > filters.limit;
    const page = hasMore ? issues.slice(0, -1) : issues;

    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async listIssuesForOrder(orderId: string, requestingUserId?: string, requestingPilotId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    if (requestingUserId && order.userId !== requestingUserId) {
      throw new ForbiddenError("Not your order");
    }
    if (requestingPilotId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const owns = order.shipments.some((s: any) => s.pilotId === requestingPilotId);
      if (!owns) throw new ForbiddenError("You are not assigned to any item on this order");
    }

    return this.prisma.issue.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      include: { shipment: true, raisedBy: { select: { id: true, firstName: true, lastName: true, code: true } } },
    });
  }

  async resolveIssue(issueId: string, adminId: string, data: ResolveIssueBody) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundError("Issue not found");
    if (issue.resolvedAt) throw new ConflictError("This issue has already been resolved");

    return this.prisma.issue.update({
      where: { id: issueId },
      data: { resolvedAt: new Date(), resolvedById: adminId, resolutionNotes: data.resolutionNotes },
    });
  }
}