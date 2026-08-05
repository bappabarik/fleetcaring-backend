import type { Payment, Prisma } from "@prisma/client";

// The order shape every provider needs to open a payment session — same
// `include: { user: true }` shape PaymentsService already fetches.
export type OrderForPayment = Prisma.OrderGetPayload<{ include: { user: true } }>;

export interface CreateSessionResult {
  providerRef: string;
  // Whatever the client SDK needs to open its checkout UI — a Stripe
  // clientSecret, or a Razorpay order id + key id. Passed straight through
  // to the app.
  clientPayload: Record<string, unknown>;
}

export interface NormalizedWebhookEvent {
  eventId: string;
  eventType: string;
  // "IGNORED" = signature verified fine, just not an event type we act on
  // (e.g. payment_intent.created) — still worth recording for dedupe, but
  // no Payment.status change.
  status: "CAPTURED" | "FAILED" | "IGNORED";
  providerRef: string | null;
  // Only set when the gateway's captured-payment id differs from
  // providerRef (Razorpay: refunds are keyed by payment id, not order id).
  providerPaymentId?: string;
}

/**
 * One implementation per online gateway (Stripe, Razorpay). Cash on Delivery
 * is NOT a PaymentProvider — it never calls out to a gateway at all, so it's
 * handled directly in PaymentsService instead of behind this interface.
 */
export interface PaymentProvider {
  readonly name: "stripe" | "razorpay";

  createSession(order: OrderForPayment): Promise<CreateSessionResult>;

  /** Re-derives the client payload for a session already created (e.g. customer reopens checkout on a still-pending order) without creating a duplicate session with the gateway. */
  resumeSession(providerRef: string): Promise<CreateSessionResult["clientPayload"]>;

  /** Returns null (and the route should reply 400) when the signature doesn't verify. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedWebhookEvent | null;

  refund(payment: Payment): Promise<void>;
}
