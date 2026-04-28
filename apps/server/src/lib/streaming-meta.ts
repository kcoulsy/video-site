import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { video } from "@video-site/db/schema/video";
import { eq } from "drizzle-orm";

import { getRedisClient } from "./redis";

const CACHE_TTL_SECONDS = 60;
// Short negative TTL: a moderator un-deleting a video should be visible quickly.
// Positive cache is invalidated explicitly via invalidateStreamableVideoMeta on writes;
// the not-found path has no such hook so we rely on a tight TTL instead.
const NEGATIVE_CACHE_TTL_SECONDS = 5;
const cacheKey = (videoId: string) => `stream:meta:${videoId}`;

export interface StreamableVideoMeta {
  manifestPath: string | null;
  thumbnailPath: string | null;
  storyboardPath: string | null;
  thumbnailStillsCount: number;
  visibility: "public" | "unlisted" | "private";
  status: "uploading" | "uploaded" | "processing" | "ready" | "failed";
  userId: string;
  // true if author is banned, suspended, or video is soft-deleted — caller should 404
  blocked: boolean;
}

export async function getStreamableVideoMeta(videoId: string): Promise<StreamableVideoMeta | null> {
  const redis = getRedisClient();
  const key = cacheKey(videoId);

  const cached = await redis.get(key);
  if (cached !== null) {
    if (cached === "__null__") return null;
    return JSON.parse(cached) as StreamableVideoMeta;
  }

  const [row] = await db
    .select({
      manifestPath: video.manifestPath,
      thumbnailPath: video.thumbnailPath,
      storyboardPath: video.storyboardPath,
      thumbnailStillsCount: video.thumbnailStillsCount,
      visibility: video.visibility,
      status: video.status,
      userId: video.userId,
      deletedAt: video.deletedAt,
      authorBannedAt: user.bannedAt,
      authorSuspendedUntil: user.suspendedUntil,
    })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(eq(video.id, videoId))
    .limit(1);

  if (!row) {
    await redis.set(key, "__null__", "EX", NEGATIVE_CACHE_TTL_SECONDS);
    return null;
  }

  const blocked =
    row.deletedAt !== null ||
    row.authorBannedAt !== null ||
    (row.authorSuspendedUntil !== null && row.authorSuspendedUntil > new Date());

  const meta: StreamableVideoMeta = {
    manifestPath: row.manifestPath,
    thumbnailPath: row.thumbnailPath,
    storyboardPath: row.storyboardPath,
    thumbnailStillsCount: row.thumbnailStillsCount,
    visibility: row.visibility,
    status: row.status,
    userId: row.userId,
    blocked,
  };

  await redis.set(key, JSON.stringify(meta), "EX", CACHE_TTL_SECONDS);
  return meta;
}

export async function invalidateStreamableVideoMeta(videoId: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(cacheKey(videoId));
}
