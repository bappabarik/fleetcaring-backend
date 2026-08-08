import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { ShiftsService } from "../modules/shifts/shifts.service.js";
import { SHIFT_EXPIRY_QUEUE, parseRedisConnectionOptions } from "../lib/queues.js";
import { env } from "../config/env.js";

export function startShiftExpiryWorker(app: FastifyInstance): Worker {
  const worker = new Worker(
    SHIFT_EXPIRY_QUEUE,
    async () => {
      const service = new ShiftsService(app);
      const result = await service.expireOverdueShifts();
      if (result.completed > 0 || result.noShow > 0) {
        app.log.info(result, "Shift expiry run closed out overdue shifts");
      }
      return result;
    },
    { connection: parseRedisConnectionOptions(env.REDIS_URL) }
  );

  worker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Shift expiry job failed");
  });

  return worker;
}
