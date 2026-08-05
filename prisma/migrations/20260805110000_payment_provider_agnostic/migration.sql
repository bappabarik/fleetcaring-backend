-- Make payments gateway-agnostic: Payment.provider already stores a free-text
-- value ("stripe", now also "razorpay" / "cod"), no column change needed there.
-- Add providerPaymentId for gateways (Razorpay) where the captured-payment id
-- differs from the session/order id used to create the payment. Generalize the
-- webhook idempotency table away from being Stripe-only.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "providerPaymentId" TEXT;

-- Rename table + add provider column (existing rows are all historical Stripe
-- events, so backfilling them as 'stripe' is correct, not a guess).
ALTER TABLE "StripeWebhookEvent" RENAME TO "PaymentWebhookEvent";
ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE "PaymentWebhookEvent" ALTER COLUMN "provider" DROP DEFAULT;

-- Swap the primary key from bare id to (provider, id) — an event id is only
-- unique within its own provider's id space.
ALTER TABLE "PaymentWebhookEvent" DROP CONSTRAINT "StripeWebhookEvent_pkey";
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("provider", "id");
