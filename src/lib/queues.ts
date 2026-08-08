import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const TIMESLOT_MATERIALIZER_QUEUE = "timeslot-materializer";
export const BREAK_EXPIRY_QUEUE = "break-expiry";
export const SHIFT_EXPIRY_QUEUE = "shift-expiry";
export const PAYMENT_WEBHOOK_QUEUE = "payment-webhook-processor";
export const PUSH_NOTIFICATION_QUEUE = "push-dispatcher";

/**
 * BullMQ bundles its own internal copy of ioredis, which is a distinct
 * module instance from our app's own `ioredis` dependency — passing an
 * already-constructed `Redis` instance (like `app.redis`) into BullMQ
 * causes a real type mismatch between the two copies. Passing plain
 * connection options instead sidesteps this entirely, and lets each
 * Queue/Worker manage its own dedicated connection — the pattern BullMQ
 * itself recommends rather than sharing one connection across many uses.
 */
export function parseRedisConnectionOptions(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

export function createTimeslotMaterializerQueue(): Queue {
  return new Queue(TIMESLOT_MATERIALIZER_QUEUE, {
    connection: parseRedisConnectionOptions(env.REDIS_URL),
  });
}


export function createBreakExpiryQueue(): Queue {
  return new Queue(BREAK_EXPIRY_QUEUE, {
    connection: parseRedisConnectionOptions(env.REDIS_URL),
  });
}


export function createShiftExpiryQueue(): Queue {
  return new Queue(SHIFT_EXPIRY_QUEUE, {
    connection: parseRedisConnectionOptions(env.REDIS_URL),
  });
}


export function createPaymentWebhookQueue(): Queue {
  return new Queue(PAYMENT_WEBHOOK_QUEUE, {
    connection: parseRedisConnectionOptions(env.REDIS_URL),
  });
}


export function createPushNotificationQueue(): Queue {
  return new Queue(PUSH_NOTIFICATION_QUEUE, {
    connection: parseRedisConnectionOptions(env.REDIS_URL),
  });
}