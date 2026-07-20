import type { FastifyInstance } from "fastify";
import { stripe, isStripeConfigured } from "../../lib/stripe.js";
import { env } from "../../config/env.js";
import { createStripeWebhookQueue } from "../../lib/queues.js";

export async function paymentsWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  const webhookQueue = createStripeWebhookQueue();

  app.post("/webhook", async (request, reply) => {
    if (!isStripeConfigured || !stripe) {
      return reply.status(503).send({ error: "STRIPE_NOT_CONFIGURED" });
    }

    const signature = request.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      return reply.status(400).send({ error: "Missing Stripe-Signature header" });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(request.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      request.log.warn({ err }, "Stripe webhook signature verification failed");
      return reply.status(400).send({ error: "Invalid signature" });
    }

    await webhookQueue.add(event.type, {
      eventId: event.id,
      type: event.type,
      data: event.data.object,
    });

    return reply.send({ received: true });
  });
}