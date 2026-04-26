import { env } from "@video-site/env/worker";
import { Queue, Worker } from "bullmq";

import { processCleanup } from "./processors/cleanup";
import {
  processGuestCleanup,
  processRecsBuildSimilarity,
  processRecsBuildTrending,
  processRecsBuildUserCf,
} from "./processors/recommendations";
import { processThumbnail } from "./processors/thumbnail";
import { processTranscode } from "./processors/transcode";
import { CLEANUP_QUEUE, RECS_QUEUE, THUMBNAIL_QUEUE, TRANSCODE_QUEUE, connection } from "./queues";
import type { RecsJobData } from "./types";

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

const recsWorker = new Worker<RecsJobData>(
  RECS_QUEUE,
  async (job) => {
    switch (job.data.type) {
      case "build-similarity":
        await processRecsBuildSimilarity(job);
        break;
      case "build-trending":
        await processRecsBuildTrending(job);
        break;
      case "build-user-cf":
        await processRecsBuildUserCf(job);
        break;
      case "guest-cleanup":
        await processGuestCleanup(job);
        break;
    }
  },
  { connection, concurrency: 1 },
);

const workers = {
  transcode: transcodeWorker,
  thumbnail: thumbnailWorker,
  cleanup: cleanupWorker,
  recs: recsWorker,
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

const recsQueue = new Queue<RecsJobData>(RECS_QUEUE, { connection });
await recsQueue.add(
  "build-similarity",
  { type: "build-similarity" },
  {
    // Nightly at ~03:00 UTC; BullMQ doesn't support cron natively here so we use 24h cadence.
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId: "repeat-build-similarity",
  },
);
await recsQueue.add(
  "build-trending",
  { type: "build-trending" },
  {
    repeat: { every: 60 * 60 * 1000 },
    jobId: "repeat-build-trending",
  },
);
await recsQueue.add(
  "build-user-cf",
  { type: "build-user-cf" },
  {
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId: "repeat-build-user-cf",
  },
);
await recsQueue.add(
  "guest-cleanup",
  { type: "guest-cleanup" },
  {
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId: "repeat-guest-cleanup",
  },
);

async function shutdown() {
  console.log("shutting down workers...");
  await Promise.all([
    transcodeWorker.close(),
    thumbnailWorker.close(),
    cleanupWorker.close(),
    recsWorker.close(),
  ]);
  await cleanupQueue.close();
  await recsQueue.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(
  `worker started (transcode concurrency: ${env.CONCURRENCY}, thumbnail: 2, cleanup: 1, recs: 1)`,
);
