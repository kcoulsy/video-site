import { env } from "@video-site/env/worker";
import { Queue, Worker } from "bullmq";

import { processCleanup } from "./processors/cleanup";
import { processThumbnail } from "./processors/thumbnail";
import { processTranscode } from "./processors/transcode";
import { CLEANUP_QUEUE, THUMBNAIL_QUEUE, TRANSCODE_QUEUE, connection } from "./queues";

const transcodeWorker = new Worker(TRANSCODE_QUEUE, processTranscode, {
  connection,
  concurrency: env.CONCURRENCY,
});

const thumbnailWorker = new Worker(THUMBNAIL_QUEUE, processThumbnail, {
  connection,
  concurrency: 2,
});

const cleanupWorker = new Worker(CLEANUP_QUEUE, processCleanup, {
  connection,
  concurrency: 1,
});

const workers = {
  transcode: transcodeWorker,
  thumbnail: thumbnailWorker,
  cleanup: cleanupWorker,
};

for (const [name, worker] of Object.entries(workers)) {
  worker.on("completed", (job) => {
    console.log(`[${name}] job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[${name}] job ${job?.id} failed: ${err.message}`);
  });
  worker.on("error", (err) => {
    console.error(`[${name}] worker error: ${err.message}`);
  });
}

const cleanupQueue = new Queue(CLEANUP_QUEUE, { connection });
await cleanupQueue.add(
  "stale-uploads",
  { type: "stale-uploads" },
  {
    repeat: { every: 60 * 60 * 1000 },
    jobId: "repeat-stale-uploads",
  },
);
await cleanupQueue.add(
  "failed-videos",
  { type: "failed-videos" },
  {
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId: "repeat-failed-videos",
  },
);

async function shutdown() {
  console.log("shutting down workers...");
  await Promise.all([transcodeWorker.close(), thumbnailWorker.close(), cleanupWorker.close()]);
  await cleanupQueue.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`worker started (transcode concurrency: ${env.CONCURRENCY}, thumbnail: 2, cleanup: 1)`);
