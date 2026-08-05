import type { FastifyInstance } from "fastify";
import type { FinanceReportQuery } from "./finance.schemas.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class FinanceService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  /**
   * Deliberately aggregates in application code rather than a raw SQL
   * GROUP BY — for a reporting date-range query at this scale that's the
   * simpler, easier-to-verify-correct option. If order volume grows large
   * enough that loading every matching row becomes a real cost, this is
   * the first place to revisit with a proper SQL aggregate query instead.
   */
  async getReport(filters: FinanceReportQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
      if (filters.dateTo) where.createdAt.lte = filters.dateTo;
    }

    if (filters.zoneId) where.address = { zoneId: filters.zoneId };

    const orders = await this.prisma.order.findMany({
      where,
      include: { payment: true },
    });

    let totalRevenue = 0;
    let totalRefunded = 0;
    let discountTotal = 0;
    let completedOrderCount = 0;
    let cancelledOrderCount = 0;

    const dailyMap = new Map<string, { revenue: number; orderCount: number }>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const order of orders as any[]) {
      discountTotal += Number(order.discount);
      if (order.completedAt) completedOrderCount++;
      if (order.cancelledAt) cancelledOrderCount++;

      const dateKey = order.createdAt.toISOString().split("T")[0];
      const dayEntry = dailyMap.get(dateKey) ?? { revenue: 0, orderCount: 0 };
      dayEntry.orderCount += 1;

      // A refund overwrites the payment's status to REFUNDED (see
      // PaymentsService.refundPayment) — so a refunded order's amount is
      // attributed ONLY to totalRefunded, never double-counted in
      // totalRevenue, and netRevenue below correctly nets it out.
      if (order.payment) {
        const amount = Number(order.payment.amount);
        if (order.payment.status === "CAPTURED" || order.payment.status === "HOLD_SUCCESS") {
          totalRevenue += amount;
          dayEntry.revenue += amount;
        } else if (order.payment.status === "REFUNDED") {
          totalRefunded += amount;
        }
      }

      dailyMap.set(dateKey, dayEntry);
    }

    const dailyBreakdown = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        revenue: round2(data.revenue),
        orderCount: data.orderCount,
      }));

    return {
      orderCount: orders.length,
      completedOrderCount,
      cancelledOrderCount,
      totalRevenue: round2(totalRevenue),
      totalRefunded: round2(totalRefunded),
      netRevenue: round2(totalRevenue - totalRefunded),
      discountTotal: round2(discountTotal),
      averageOrderValue: orders.length > 0 ? round2(totalRevenue / orders.length) : 0,
      dailyBreakdown,
    };
  }
}
