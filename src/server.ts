import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { createTimeslotMaterializerQueue, createBreakExpiryQueue } from "./lib/queues.js";
import { startTimeslotMaterializerWorker } from "./workers/timeslotMaterializer.worker.js";
import { startBreakExpiryWorker } from "./workers/breakExpiry.worker.js";

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`FleetCaring API listening on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const materializerQueue = createTimeslotMaterializerQueue();
  await materializerQueue.add(
    "nightly-materialize",
    {},
    { repeat: { pattern: "0 2 * * *" }, jobId: "nightly-materialize" }
  );
  const materializerWorker = startTimeslotMaterializerWorker(app);

  const breakExpiryQueue = createBreakExpiryQueue();
  await breakExpiryQueue.add(
    "check-overdue-breaks",
    {},
    { repeat: { pattern: "* * * * *" }, jobId: "check-overdue-breaks" }
  );
  const breakExpiryWorker = startBreakExpiryWorker(app);

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await materializerWorker.close();
    await materializerQueue.close();
    await breakExpiryWorker.close();
    await breakExpiryQueue.close();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});