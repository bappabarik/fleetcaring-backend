import fp from "fastify-plugin";
import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required for BullMQ-compatible connections
  });

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async (instance) => {
    instance.redis.disconnect();
  });
});
