import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import type { PaymentProvider } from "./provider.js";
import { StripeProvider } from "./stripeProvider.js";
import { RazorpayProvider } from "./razorpayProvider.js";

export type { PaymentProvider, OrderForPayment, NormalizedWebhookEvent } from "./provider.js";

const providersByName: Record<string, (app: FastifyInstance) => PaymentProvider> = {
  stripe: (app) => new StripeProvider(app),
  razorpay: () => new RazorpayProvider(),
};

/** The single online gateway this deployment is configured for (env.PAYMENT_PROVIDER) — a per-deployment config, not a runtime user choice. */
export function getPaymentProvider(app: FastifyInstance): PaymentProvider {
  return providersByName[env.PAYMENT_PROVIDER](app);
}

/** Looks up a provider by name for webhook routing, where the gateway is identified by the URL (`/webhook/:provider`) rather than env.PAYMENT_PROVIDER — lets a webhook from a previously-active gateway still be processed after a deployment switches providers. */
export function getPaymentProviderByName(app: FastifyInstance, name: string): PaymentProvider | null {
  const factory = providersByName[name];
  return factory ? factory(app) : null;
}
