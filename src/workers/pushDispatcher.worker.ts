import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { PUSH_NOTIFICATION_QUEUE, parseRedisConnectionOptions } from "../lib/queues.js";
import { env } from "../config/env.js";
import { sendPushNotification } from "../lib/fcm.js";
import type { PushJobData } from "../modules/notifications/notifications.service.js";

export function startPushDispatcherWorker(app: FastifyInstance): Worker<PushJobData> {
  const worker = new Worker<PushJobData>(
    PUSH_NOTIFICATION_QUEUE,
    async (job) => {
      await sendPushNotification(job.data);
    },
    { connection: parseRedisConnectionOptions(env.REDIS_URL) }
  );

  worker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Push notification job failed");
  });

  return worker;
}