import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { PAYMENT_WEBHOOK_QUEUE, parseRedisConnectionOptions } from "../lib/queues.js";
import { env } from "../config/env.js";

interface PaymentWebhookJobData {
  provider: string;
  eventId: string;
  eventType: string;
  status: "CAPTURED" | "FAILED" | "IGNORED";
  providerRef: string | null;
  providerPaymentId?: string;
}

export function startPaymentWebhookWorker(app: FastifyInstance): Worker<PaymentWebhookJobData> {
  const worker = new Worker<PaymentWebhookJobData>(
    PAYMENT_WEBHOOK_QUEUE,
    async (job) => {
      const { provider, eventId, eventType, status, providerRef, providerPaymentId } = job.data;

      try {
        await app.prisma.paymentWebhookEvent.create({ data: { provider, id: eventId, type: eventType } });
      } catch {
        app.log.info({ provider, eventId }, "Duplicate payment webhook delivery, skipping");
        return;
      }

      if (status === "IGNORED" || !providerRef) {
        app.log.info({ provider, eventType }, "Unhandled payment webhook event type, ignoring");
        return;
      }

      await app.prisma.payment.updateMany({
        where: { providerRef },
        data: { status, ...(providerPaymentId ? { providerPaymentId } : {}) },
      });
    },
    { connection: parseRedisConnectionOptions(env.REDIS_URL) }
  );

  worker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Payment webhook processing job failed");
  });

  return worker;
}
