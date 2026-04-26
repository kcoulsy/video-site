import { env } from "@video-site/env/worker";
import IORedis from "ioredis";

export const TRANSCODE_QUEUE = "video-transcode";
export const THUMBNAIL_QUEUE = "video-thumbnail";
export const CLEANUP_QUEUE = "video-cleanup";
export const RECS_QUEUE = "recommendations";

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
