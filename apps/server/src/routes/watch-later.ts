import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { video } from "@video-site/db/schema/video";
import { watchLater } from "@video-site/db/schema/watch-later";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { NotFoundError, ValidationError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

export const watchLaterRoutes = new Hono<{ Variables: AppVariables }>();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(24),
});

watchLaterRoutes.get("/watch-later", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }
  const { page, limit } = parsed.data;

  const rows = await db
    .select({
      videoId: watchLater.videoId,
      addedAt: watchLater.addedAt,
      videoTitle: video.title,
      videoThumbnailPath: video.thumbnailPath,
      videoDuration: video.duration,
      videoStatus: video.status,
      videoViewCount: video.viewCount,
      ownerId: user.id,
      ownerName: user.name,
      ownerImage: user.image,
      total: sql<number>`COUNT(*) OVER()::int`,
    })
    .from(watchLater)
    .innerJoin(video, eq(video.id, watchLater.videoId))
    .innerJoin(user, eq(user.id, video.userId))
    .where(
      and(
        eq(watchLater.userId, userId),
        isNull(video.deletedAt),
        isNull(user.bannedAt),
        or(isNull(user.suspendedUntil), sql`${user.suspendedUntil} < NOW()`),
      ),
    )
    .orderBy(desc(watchLater.addedAt))
    .limit(limit + 1)
    .offset((page - 1) * limit);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const total = rows[0]?.total ?? 0;

  const items = slice.map((r) => ({
    videoId: r.videoId,
    addedAt: r.addedAt,
    video: {
      id: r.videoId,
      title: r.videoTitle,
      thumbnailUrl: r.videoThumbnailPath ? `/api/stream/${r.videoId}/thumbnail` : null,
      duration: r.videoDuration,
      status: r.videoStatus,
      viewCount: r.videoViewCount,
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

watchLaterRoutes.get("/watch-later/:videoId/status", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");
  const row = await db.query.watchLater.findFirst({
    where: and(eq(watchLater.userId, userId), eq(watchLater.videoId, videoId)),
  });
  return c.json({ saved: !!row });
});

watchLaterRoutes.post("/watch-later/:videoId", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  const [v] = await db.select({ id: video.id }).from(video).where(eq(video.id, videoId)).limit(1);
  if (!v) {
    throw new NotFoundError("Video");
  }

  await db
    .insert(watchLater)
    .values({ userId, videoId })
    .onConflictDoNothing({ target: [watchLater.userId, watchLater.videoId] });

  return c.json({ saved: true });
});

watchLaterRoutes.delete("/watch-later/:videoId", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");
  await db
    .delete(watchLater)
    .where(and(eq(watchLater.userId, userId), eq(watchLater.videoId, videoId)));
  return c.json({ saved: false });
});

watchLaterRoutes.delete("/watch-later", requireAuth, async (c) => {
  const userId = c.get("user").id;
  await db.delete(watchLater).where(eq(watchLater.userId, userId));
  return c.json({ ok: true });
});
