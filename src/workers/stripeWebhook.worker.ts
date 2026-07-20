import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { STRIPE_WEBHOOK_QUEUE, parseRedisConnectionOptions } from "../lib/queues.js";
import { env } from "../config/env.js";

interface StripeWebhookJobData {
  eventId: string;
  type: string;
  data: { id?: string };
}

export function startStripeWebhookWorker(app: FastifyInstance): Worker<StripeWebhookJobData> {
  const worker = new Worker<StripeWebhookJobData>(
    STRIPE_WEBHOOK_QUEUE,
    async (job) => {
      const { eventId, type, data } = job.data;

      try {
        await app.prisma.stripeWebhookEvent.create({ data: { id: eventId, type } });
      } catch {
        app.log.info({ eventId }, "Duplicate Stripe webhook delivery, skipping");
        return;
      }

      const paymentIntentId = data.id;

      if (type === "payment_intent.succeeded" && paymentIntentId) {
        await app.prisma.payment.updateMany({
          where: { providerRef: paymentIntentId },
          data: { status: "CAPTURED" },
        });
      } else if (type === "payment_intent.payment_failed" && paymentIntentId) {
        await app.prisma.payment.updateMany({
          where: { providerRef: paymentIntentId },
          data: { status: "FAILED" },
        });
      } else {
        app.log.info({ type }, "Unhandled Stripe webhook event type, ignoring");
      }
    },
    { connection: parseRedisConnectionOptions(env.REDIS_URL) }
  );

  worker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Stripe webhook processing job failed");
  });

  return worker;
}