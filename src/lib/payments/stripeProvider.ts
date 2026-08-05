import type { Payment } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { stripe, isStripeConfigured } from "../stripe.js";
import { env } from "../../config/env.js";
import { ConflictError } from "../errors.js";
import type { PaymentProvider, OrderForPayment, CreateSessionResult, NormalizedWebhookEvent } from "./provider.js";

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;

  constructor(private app: FastifyInstance) {}

  private get prisma() {
    return this.app.prisma;
  }

  async createSession(order: OrderForPayment): Promise<CreateSessionResult> {
    if (!isStripeConfigured || !stripe) {
      throw new ConflictError("Payments are not configured yet — set STRIPE_SECRET_KEY");
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

    // Stripe amounts are in the currency's smallest unit — both AED and INR
    // use 100 minor units (fils / paise), so this math is currency-agnostic
    // already; only the currency code below needs to vary per deployment.
    const amountMinorUnits = Math.round(Number(order.total) * 100);

    const intent = await stripe.paymentIntents.create({
      amount: amountMinorUnits,
      currency: env.CURRENCY_CODE.toLowerCase(),
      customer: stripeCustomerId,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    });

    return { providerRef: intent.id, clientPayload: { clientSecret: intent.client_secret } };
  }

  async resumeSession(providerRef: string): Promise<Record<string, unknown>> {
    if (!isStripeConfigured || !stripe) {
      throw new ConflictError("Payments are not configured yet — set STRIPE_SECRET_KEY");
    }
    const intent = await stripe.paymentIntents.retrieve(providerRef);
    return { clientSecret: intent.client_secret };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedWebhookEvent | null {
    if (!isStripeConfigured || !stripe) return null;

    const signature = headers["stripe-signature"];
    if (!signature || typeof signature !== "string") return null;

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return null;
    }

    const paymentIntentId = (event.data.object as { id?: string }).id ?? null;

    if (event.type === "payment_intent.succeeded") {
      return { eventId: event.id, eventType: event.type, providerRef: paymentIntentId, status: "CAPTURED" };
    }
    if (event.type === "payment_intent.payment_failed") {
      return { eventId: event.id, eventType: event.type, providerRef: paymentIntentId, status: "FAILED" };
    }
    // Recognized-but-unhandled event types (e.g. payment_intent.created) —
    // still a valid, verified delivery, just not one that changes our
    // Payment status. Returning null here would make the caller treat every
    // unhandled type as an invalid signature, which it isn't.
    return { eventId: event.id, eventType: event.type, providerRef: paymentIntentId, status: "IGNORED" };
  }

  async refund(payment: Payment): Promise<void> {
    if (!isStripeConfigured || !stripe) {
      throw new ConflictError("Payments are not configured yet — set STRIPE_SECRET_KEY");
    }
    if (!payment.providerRef) throw new ConflictError("This payment has no associated Stripe PaymentIntent");
    await stripe.refunds.create({ payment_intent: payment.providerRef });
  }
}
