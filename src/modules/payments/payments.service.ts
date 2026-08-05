import type { FastifyInstance } from "fastify";
import type { Payment } from "@prisma/client";
import { NotFoundError, ForbiddenError, ConflictError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { getPaymentProvider, getPaymentProviderByName } from "../../lib/payments/index.js";

export type PaymentMethod = "online" | "cod";

export class PaymentsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async createPaymentIntent(orderId: string, userId: string, method: PaymentMethod = "online") {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.userId !== userId) throw new ForbiddenError("Not your order");

    const existing = await this.prisma.payment.findUnique({ where: { orderId } });
    if (existing && (existing.status === "CAPTURED" || existing.status === "HOLD_SUCCESS")) {
      throw new ConflictError("This order has already been paid");
    }

    if (method === "cod") {
      if (!env.COD_ENABLED) throw new ConflictError("Cash on Delivery is not available");

      const payment = await this.prisma.payment.upsert({
        where: { orderId },
        update: { provider: "cod", status: "PENDING", providerRef: null, providerPaymentId: null, amount: order.total },
        create: { orderId, provider: "cod", status: "PENDING", amount: order.total },
      });
      return { method: "cod" as const, paymentId: payment.id };
    }

    const provider = getPaymentProvider(this.app);

    // Reopening checkout on a still-pending order — reuse the same gateway
    // session instead of creating a duplicate one, but only if it was this
    // same gateway (a deployment can switch PAYMENT_PROVIDER between when
    // the order was created and now, in which case the old providerRef is
    // meaningless to the new gateway and we fall through to a fresh session).
    if (existing?.provider === provider.name && existing.providerRef) {
      const clientPayload = await provider.resumeSession(existing.providerRef);
      return { method: "online" as const, provider: provider.name, paymentId: existing.id, ...clientPayload };
    }

    const { providerRef, clientPayload } = await provider.createSession(order);

    const payment = await this.prisma.payment.upsert({
      where: { orderId },
      update: { provider: provider.name, status: "PENDING", providerRef, providerPaymentId: null, amount: order.total },
      create: { orderId, provider: provider.name, status: "PENDING", providerRef, amount: order.total },
    });

    return { method: "online" as const, provider: provider.name, paymentId: payment.id, ...clientPayload };
  }

  async getPaymentForOrder(orderId: string, requestingUserId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order not found");
    if (requestingUserId && order.userId !== requestingUserId) throw new ForbiddenError("Not your order");

    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundError("No payment found for this order");
    return payment;
  }

  async refundPayment(orderId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundError("No payment found for this order");
    if (payment.status !== "CAPTURED" && payment.status !== "HOLD_SUCCESS") {
      throw new ConflictError(`Cannot refund a payment with status ${payment.status}`);
    }
    if (payment.provider === "cod") {
      throw new ConflictError("Cash payments can't be refunded automatically — handle this as a manual cash return");
    }

    // Refund with whichever gateway actually captured this payment, not
    // necessarily today's active PAYMENT_PROVIDER (a deployment can switch
    // gateways after older payments were already captured with the old one).
    const provider = getPaymentProviderByName(this.app, payment.provider);
    if (!provider) throw new ConflictError(`Unknown payment provider "${payment.provider}"`);

    await provider.refund(payment);

    return this.prisma.payment.update({ where: { orderId }, data: { status: "REFUNDED" } });
  }

  /** Called by the pilot who's assigned to every shipment on this order, at job completion. */
  async collectCodAsPilot(orderId: string, pilotId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order not found");

    const notOwned = order.shipments.filter((s) => s.pilotId !== pilotId);
    if (notOwned.length > 0) throw new ForbiddenError("You are not assigned to every item on this order");

    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    return this.markCodCollected(orderId, payment);
  }

  /** Admin correction — mark a COD payment collected/uncollected regardless of who's assigned, e.g. to fix a pilot's missed tap or a dispute. */
  async setCodCollected(orderId: string, collected: boolean) {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundError("No payment found for this order");
    if (payment.provider !== "cod") throw new ConflictError("This order isn't paying by Cash on Delivery");

    return this.prisma.payment.update({ where: { orderId }, data: { status: collected ? "CAPTURED" : "PENDING" } });
  }

  private async markCodCollected(orderId: string, payment: Payment | null) {
    if (!payment) throw new NotFoundError("No payment found for this order");
    if (payment.provider !== "cod") throw new ConflictError("This order isn't paying by Cash on Delivery");
    if (payment.status === "CAPTURED") return payment; // already marked — idempotent no-op
    if (payment.status !== "PENDING") throw new ConflictError(`Cannot collect a payment with status ${payment.status}`);

    return this.prisma.payment.update({ where: { orderId }, data: { status: "CAPTURED" } });
  }
}
