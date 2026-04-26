import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { video } from "@video-site/db/schema/video";
import { watchHistory } from "@video-site/db/schema/watch-history";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { NotFoundError, ValidationError } from "../lib/errors";
import { requireActiveUser } from "../middleware/require-active-user";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

export const watchHistoryRoutes = new Hono<{ Variables: AppVariables }>();

const progressSchema = z.object({
  watchedSeconds: z.number().nonnegative().finite(),
  totalDuration: z.number().positive().finite(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(24),
});

async function readProgressBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

watchHistoryRoutes.post("/videos/:videoId/progress", ...requireActiveUser, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  const raw = await readProgressBody(c.req.raw);
  const parsed = progressSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const watchedSeconds = Math.floor(parsed.data.watchedSeconds);
  const totalDuration = Math.floor(parsed.data.totalDuration);
  const progressPercent = Math.min(watchedSeconds / totalDuration, 1.0);
  const completed = progressPercent >= 0.9;
  const now = new Date();

  const [videoRow] = await db
    .select({ id: video.id })
    .from(video)
    .where(eq(video.id, videoId))
    .limit(1);
  if (!videoRow) {
    throw new NotFoundError("Video");
  }

  await db
    .insert(watchHistory)
    .values({
      userId,
      videoId,
      watchedSeconds,
      totalDuration,
      progressPercent,
      completedAt: completed ? now : null,
      lastWatchedAt: now,
    })
    .onConflictDoUpdate({
      target: [watchHistory.userId, watchHistory.videoId],
      set: {
        watchedSeconds,
        totalDuration,
        progressPercent,
        completedAt: completed ? now : sql`${watchHistory.completedAt}`,
        lastWatchedAt: now,
      },
    });

  return c.json({ ok: true });
});

watchHistoryRoutes.get("/videos/:videoId/progress", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  const entry = await db.query.watchHistory.findFirst({
    where: and(eq(watchHistory.userId, userId), eq(watchHistory.videoId, videoId)),
  });

  if (!entry) {
    return c.json({
      watchedSeconds: 0,
      totalDuration: 0,
      progressPercent: 0,
      completedAt: null,
    });
  }

  return c.json({
    watchedSeconds: entry.watchedSeconds,
    totalDuration: entry.totalDuration,
    progressPercent: entry.progressPercent,
    completedAt: entry.completedAt,
  });
});

watchHistoryRoutes.get("/history", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }
  const { page, limit } = parsed.data;

  const rows = await db
    .select({
      videoId: watchHistory.videoId,
      watchedSeconds: watchHistory.watchedSeconds,
      totalDuration: watchHistory.totalDuration,
      progressPercent: watchHistory.progressPercent,
      completedAt: watchHistory.completedAt,
      lastWatchedAt: watchHistory.lastWatchedAt,
      videoTitle: video.title,
      videoThumbnailPath: video.thumbnailPath,
      videoDuration: video.duration,
      videoStatus: video.status,
      ownerId: user.id,
      ownerName: user.name,
      ownerImage: user.image,
    })
    .from(watchHistory)
    .innerJoin(video, eq(video.id, watchHistory.videoId))
    .innerJoin(user, eq(user.id, video.userId))
    .where(
      and(
        eq(watchHistory.userId, userId),
        isNull(video.deletedAt),
        isNull(user.bannedAt),
        or(isNull(user.suspendedUntil), sql`${user.suspendedUntil} < NOW()`),
      ),
    )
    .orderBy(desc(watchHistory.lastWatchedAt))
    .limit(limit + 1)
    .offset((page - 1) * limit);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(watchHistory)
    .where(eq(watchHistory.userId, userId));
  const total = countResult[0]?.count ?? 0;

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  const items = slice.map((r) => ({
    videoId: r.videoId,
    watchedSeconds: r.watchedSeconds,
    totalDuration: r.totalDuration,
    progressPercent: r.progressPercent,
    completedAt: r.completedAt,
    lastWatchedAt: r.lastWatchedAt,
    video: {
      id: r.videoId,
      title: r.videoTitle,
      thumbnailUrl: r.videoThumbnailPath ? `/api/stream/${r.videoId}/thumbnail` : null,
      duration: r.videoDuration,
      status: r.videoStatus,
      user: { id: r.ownerId, name: r.ownerName, image: r.ownerImage },
    },
  }));

  return c.json({
    items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasMore,
  });
});

watchHistoryRoutes.delete("/history/:videoId", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  await db
    .delete(watchHistory)
    .where(and(eq(watchHistory.userId, userId), eq(watchHistory.videoId, videoId)));

  return c.json({ ok: true });
});

watchHistoryRoutes.delete("/history", requireAuth, async (c) => {
  const userId = c.get("user").id;
  await db.delete(watchHistory).where(eq(watchHistory.userId, userId));
  return c.json({ ok: true });
});
