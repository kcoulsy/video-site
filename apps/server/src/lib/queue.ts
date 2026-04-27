import { env } from "@video-site/env/server";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

interface TranscodeJobData {
  videoId: string;
  rawPath: string;
  userId: string;
}

interface ThumbnailJobData {
  videoId: string;
  thumbnailSourcePath: string;
}

interface CleanupJobData {
  type: "stale-uploads" | "failed-videos" | "delete-video";
  videoId?: string;
}

type NotificationKind = "new_upload" | "comment_reply" | "video_like" | "comment_like" | "mention";

type NotificationJobData =
  | { type: "fanout-new-upload"; videoId: string; channelId: string }
  | {
      type: "single";
      recipientId: string;
      kind: NotificationKind;
      actorId?: string;
      videoId?: string;
      commentId?: string;
      coalesceWindowSec?: number;
    };

export const transcodeQueue = new Queue<TranscodeJobData>("video-transcode", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const thumbnailQueue = new Queue<ThumbnailJobData>("video-thumbnail", {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 20 },
  },
});

export const cleanupQueue = new Queue<CleanupJobData>("video-cleanup", {
  connection,
});

export const notificationsQueue = new Queue<NotificationJobData>("notifications", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export async function enqueueNotification(data: NotificationJobData) {
  try {
    await notificationsQueue.add("notify", data);
  } catch (err) {
    console.error("[notification] enqueue failed:", err);
  }
}
