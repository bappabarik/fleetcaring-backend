import type { Payment } from "@prisma/client";
import Razorpay from "razorpay";
import { env } from "../../config/env.js";
import { ConflictError } from "../errors.js";
import type { PaymentProvider, OrderForPayment, CreateSessionResult, NormalizedWebhookEvent } from "./provider.js";

export const isRazorpayConfigured = !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

const razorpay = isRazorpayConfigured
  ? new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET })
  : null;

interface RazorpayPaymentEntity {
  id: string; // "pay_..."
  order_id: string; // "order_..."
}

export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay" as const;

  async createSession(order: OrderForPayment): Promise<CreateSessionResult> {
    if (!isRazorpayConfigured || !razorpay) {
      throw new ConflictError("Payments are not configured yet — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET");
    }

    // Razorpay amounts are in the currency's smallest unit too (paise for
    // INR), same convention Stripe uses — this math already matches what
    // StripeProvider does.
    const amountMinorUnits = Math.round(Number(order.total) * 100);

    const rpOrder = await razorpay.orders.create({
      amount: amountMinorUnits,
      currency: env.CURRENCY_CODE.toUpperCase(),
      receipt: order.orderNumber.slice(0, 40), // Razorpay caps receipt at 40 chars
      notes: { orderId: order.id, orderNumber: order.orderNumber },
    });

    return {
      providerRef: rpOrder.id,
      clientPayload: { razorpayOrderId: rpOrder.id, razorpayKeyId: env.RAZORPAY_KEY_ID },
    };
  }

  async resumeSession(providerRef: string): Promise<Record<string, unknown>> {
    if (!isRazorpayConfigured) {
      throw new ConflictError("Payments are not configured yet — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET");
    }
    // Unlike Stripe's clientSecret, the Razorpay checkout SDK just needs the
    // order id + key back — no API round-trip needed to "resume" it.
    return { razorpayOrderId: providerRef, razorpayKeyId: env.RAZORPAY_KEY_ID };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedWebhookEvent | null {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return null;

    const signature = headers["x-razorpay-signature"];
    if (!signature || typeof signature !== "string") return null;

    const bodyString = rawBody.toString("utf8");
    if (!Razorpay.validateWebhookSignature(bodyString, signature, env.RAZORPAY_WEBHOOK_SECRET)) {
      return null;
    }

    let body: { event?: string; payload?: { payment?: { entity?: RazorpayPaymentEntity } } };
    try {
      body = JSON.parse(bodyString);
    } catch {
      return null;
    }

    const eventType = body.event ?? "unknown";
    const paymentEntity = body.payload?.payment?.entity;
    // Razorpay's webhook body doesn't reliably carry its own top-level event
    // id across API versions, so the dedupe key is synthesized from the
    // payment id + event name instead — Razorpay won't fire two distinct
    // "payment.captured" deliveries for the same payment id.
    const eventId = paymentEntity ? `${paymentEntity.id}_${eventType}` : `${eventType}_${Date.now()}`;

    if (!paymentEntity) {
      return { eventId, eventType, providerRef: null, status: "IGNORED" };
    }

    if (eventType === "payment.captured") {
      return {
        eventId,
        eventType,
        providerRef: paymentEntity.order_id,
        providerPaymentId: paymentEntity.id,
        status: "CAPTURED",
      };
    }
    if (eventType === "payment.failed") {
      return {
        eventId,
        eventType,
        providerRef: paymentEntity.order_id,
        providerPaymentId: paymentEntity.id,
        status: "FAILED",
      };
    }
    return { eventId, eventType, providerRef: paymentEntity.order_id, status: "IGNORED" };
  }

  async refund(payment: Payment): Promise<void> {
    if (!isRazorpayConfigured || !razorpay) {
      throw new ConflictError("Payments are not configured yet — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET");
    }
    // Razorpay refunds are keyed by the captured-payment id, not the order
    // id stored in providerRef — this is exactly why Payment.providerPaymentId
    // exists (populated from the "payment.captured" webhook).
    if (!payment.providerPaymentId) {
      throw new ConflictError("This payment has no associated Razorpay payment id yet — it may not have been captured");
    }
    await razorpay.payments.refund(payment.providerPaymentId, {});
  }
}
