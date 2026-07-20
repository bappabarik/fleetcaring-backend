import type { FastifyInstance } from "fastify";
import { NotFoundError, ForbiddenError, ConflictError } from "../../lib/errors.js";
import { stripe, isStripeConfigured } from "../../lib/stripe.js";

export class PaymentsService {
  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async createPaymentIntent(orderId: string, userId: string) {
    if (!isStripeConfigured || !stripe) {
      throw new ConflictError("Payments are not configured yet — set STRIPE_SECRET_KEY");
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.userId !== userId) throw new ForbiddenError("Not your order");

    const existing = await this.prisma.payment.findUnique({ where: { orderId } });
    if (existing) {
      if (existing.status === "CAPTURED" || existing.status === "HOLD_SUCCESS") {
        throw new ConflictError("This order has already been paid");
      }
      if (existing.providerRef) {
        const intent = await stripe.paymentIntents.retrieve(existing.providerRef);
        return { clientSecret: intent.client_secret, paymentId: existing.id };
      }
    }

    let stripeCustomerId = order.user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        phone: order.user.phoneNumber,
        email: order.user.email ?? undefined,
        name: order.user.name ?? undefined,
        metadata: { userId: order.user.id },
      });
      stripeCustomerId = customer.id;
      await this.prisma.user.update({ where: { id: order.user.id }, data: { stripeCustomerId } });
    }

    const amountFils = Math.round(Number(order.totalAED) * 100);

    const intent = await stripe.paymentIntents.create({
      amount: amountFils,
      currency: "aed",
      customer: stripeCustomerId,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    });

    const payment = await this.prisma.payment.upsert({
      where: { orderId },
      update: { status: "PENDING", providerRef: intent.id, amountAED: order.totalAED },
      create: {
        orderId,
        provider: "stripe",
        status: "PENDING",
        providerRef: intent.id,
        amountAED: order.totalAED,
      },
    });

    return { clientSecret: intent.client_secret, paymentId: payment.id };
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
    if (!isStripeConfigured || !stripe) {
      throw new ConflictError("Payments are not configured yet — set STRIPE_SECRET_KEY");
    }

    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundError("No payment found for this order");
    if (payment.status !== "CAPTURED" && payment.status !== "HOLD_SUCCESS") {
      throw new ConflictError(`Cannot refund a payment with status ${payment.status}`);
    }
    if (!payment.providerRef) throw new ConflictError("This payment has no associated Stripe PaymentIntent");

    await stripe.refunds.create({ payment_intent: payment.providerRef });

    return this.prisma.payment.update({ where: { orderId }, data: { status: "REFUNDED" } });
  }
}