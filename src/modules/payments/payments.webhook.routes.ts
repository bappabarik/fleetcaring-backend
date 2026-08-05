import type { FastifyInstance } from "fastify";
import { createPaymentWebhookQueue } from "../../lib/queues.js";
import { getPaymentProviderByName } from "../../lib/payments/index.js";

export async function paymentsWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  const webhookQueue = createPaymentWebhookQueue();

  // Provider is identified by the URL, not env.PAYMENT_PROVIDER — each
  // gateway's dashboard is configured to POST to its own path
  // (.../webhook/stripe, .../webhook/razorpay), so this keeps working even
  // right after a deployment switches its active gateway mid-flight.
  app.post("/webhook/:provider", async (request, reply) => {
    const { provider: providerName } = request.params as { provider: string };
    const provider = getPaymentProviderByName(app, providerName);
    if (!provider) {
      return reply.status(404).send({ error: "UNKNOWN_PROVIDER" });
    }

    const event = provider.verifyWebhook(request.body as Buffer, request.headers);
    if (!event) {
      return reply.status(400).send({ error: "Invalid signature" });
    }

    await webhookQueue.add(event.eventType, {
      provider: providerName,
      eventId: event.eventId,
      eventType: event.eventType,
      status: event.status,
      providerRef: event.providerRef,
      providerPaymentId: event.providerPaymentId,
    });

    return reply.send({ received: true });
  });
}
