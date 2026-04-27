import { env } from "@video-site/env/worker";
import { Queue } from "bullmq";
import IORedis from "ioredis";

import type { NotificationJobData } from "./types";

export const TRANSCODE_QUEUE = "video-transcode";
export const THUMBNAIL_QUEUE = "video-thumbnail";
export const CLEANUP_QUEUE = "video-cleanup";
export const RECS_QUEUE = "recommendations";
export const NOTIFICATIONS_QUEUE = "notifications";

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const notificationsQueue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});
