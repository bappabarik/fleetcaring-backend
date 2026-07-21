import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import { RealtimePubSub } from "../lib/realtime/pubsub.js";
import { createPushNotificationQueue } from "../lib/queues.js";

declare module "fastify" {
  interface FastifyInstance {
    realtime: RealtimePubSub;
    pushQueue: Queue;
  }
}

export default fp(async function realtimePlugin(fastify: FastifyInstance) {
  const realtime = new RealtimePubSub();
  const pushQueue = createPushNotificationQueue();

  fastify.decorate("realtime", realtime);
  fastify.decorate("pushQueue", pushQueue);

  fastify.addHook("onClose", async () => {
    await realtime.close();
    await pushQueue.close();
  });
});