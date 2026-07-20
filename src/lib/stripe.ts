import Stripe from "stripe";
import { env } from "../config/env.js";

export const isStripeConfigured = !!env.STRIPE_SECRET_KEY;

// No dev-mode mock here on purpose — unlike OTP, a silently-faked
// "successful payment" is the kind of thing that's actively dangerous to
// accidentally rely on. Get free Stripe test-mode keys (pk_test_/sk_test_)
// for local development instead; they're safe, don't move real money, and
// exercise the real code path.
export const stripe = isStripeConfigured ? new Stripe(env.STRIPE_SECRET_KEY) : null;