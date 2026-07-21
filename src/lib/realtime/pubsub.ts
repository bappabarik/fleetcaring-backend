import { Redis } from "ioredis";
import { parseRedisConnectionOptions } from "../queues.js";
import { env } from "../../config/env.js";

export interface RealtimeSocket {
  readyState: number;
  send(data: string): void;
}

const OPEN_STATE = 1;

export class RealtimePubSub {
  private subscriber: Redis;
  private publisher: Redis;
  private localSubscribers = new Map<string, Set<RealtimeSocket>>();

  constructor() {
    const opts = parseRedisConnectionOptions(env.REDIS_URL);
    this.subscriber = new Redis(opts);
    this.publisher = new Redis(opts);

    this.subscriber.on("message", (channel: string, message: string) => {
      const sockets = this.localSubscribers.get(channel);
      if (!sockets) return;
      for (const socket of sockets) {
        if (socket.readyState === OPEN_STATE) {
          socket.send(message);
        }
      }
    });
  }

  async subscribeSocket(channel: string, socket: RealtimeSocket): Promise<void> {
    let sockets = this.localSubscribers.get(channel);
    if (!sockets) {
      sockets = new Set();
      this.localSubscribers.set(channel, sockets);
      await this.subscriber.subscribe(channel);
    }
    sockets.add(socket);
  }

  async unsubscribeSocket(channel: string, socket: RealtimeSocket): Promise<void> {
    const sockets = this.localSubscribers.get(channel);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.localSubscribers.delete(channel);
      await this.subscriber.unsubscribe(channel);
    }
  }

  async removeSocketFromAllChannels(socket: RealtimeSocket): Promise<void> {
    const channels = [...this.localSubscribers.entries()]
      .filter(([, sockets]) => sockets.has(socket))
      .map(([channel]) => channel);

    for (const channel of channels) {
      await this.unsubscribeSocket(channel, socket);
    }
  }

  async publish(channel: string, data: unknown): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(data));
  }

  async close(): Promise<void> {
    await this.subscriber.quit();
    await this.publisher.quit();
  }
}