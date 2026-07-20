import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { ShiftsService } from "../modules/shifts/shifts.service.js";
import { BREAK_EXPIRY_QUEUE, parseRedisConnectionOptions } from "../lib/queues.js";
import { env } from "../config/env.js";

export function startBreakExpiryWorker(app: FastifyInstance): Worker {
  const worker = new Worker(
    BREAK_EXPIRY_QUEUE,
    async () => {
      const service = new ShiftsService(app);
      const result = await service.expireOverdueBreaks();
      if (result.expired > 0) {
        app.log.info(result, "Break expiry run closed out overdue breaks");
      }
      return result;
    },
    { connection: parseRedisConnectionOptions(env.REDIS_URL) }
  );

  worker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Break expiry job failed");
  });

  return worker;
}