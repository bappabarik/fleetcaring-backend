import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { TimeslotsService } from "../modules/timeslots/timeslots.service.js";
import { TIMESLOT_MATERIALIZER_QUEUE, parseRedisConnectionOptions } from "../lib/queues.js";
import { env } from "../config/env.js";

export function startTimeslotMaterializerWorker(app: FastifyInstance): Worker {
  const worker = new Worker(
    TIMESLOT_MATERIALIZER_QUEUE,
    async () => {
      const service = new TimeslotsService(app);
      const result = await service.materializeAllActiveTemplates();
      app.log.info(result, "Timeslot materialization run complete");
      return result;
    },
    { connection: parseRedisConnectionOptions(env.REDIS_URL) }
  );

  worker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Timeslot materializer job failed");
  });

  return worker;
}