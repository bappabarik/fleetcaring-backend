import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { createTimeslotMaterializerQueue } from "./lib/queues.js";
import { startTimeslotMaterializerWorker } from "./workers/timeslotMaterializer.worker.js";

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`FleetCaring API listening on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // --- Background jobs: nightly timeslot materialization ---
  // Running the worker in the same process as the API is a deliberate,
  // pragmatic choice at this scale (single modular monolith) — split into
  // a separate worker process later if job volume ever demands it.
  const materializerQueue = createTimeslotMaterializerQueue();
  await materializerQueue.add(
    "nightly-materialize",
    {},
    { repeat: { pattern: "0 2 * * *" }, jobId: "nightly-materialize" }
  );
  const materializerWorker = startTimeslotMaterializerWorker(app);

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await materializerWorker.close();
    await materializerQueue.close();
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