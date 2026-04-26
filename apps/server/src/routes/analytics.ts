import { db } from "@video-site/db";
import { video } from "@video-site/db/schema/video";
import { viewEvent } from "@video-site/db/schema/view-event";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

export const analyticsRoutes = new Hono<{ Variables: AppVariables }>();

const rangeSchema = z.object({ range: z.enum(["7d", "30d", "90d"]).default("30d") });

function rangeToInterval(range: "7d" | "30d" | "90d"): { days: number; since: Date } {
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { days, since };
}

function fillByDay(
  rows: { day: string; views: number }[],
  days: number,
): { date: string; views: number }[] {
  const map = new Map(rows.map((r) => [r.day.slice(0, 10), r.views]));
  const result: { date: string; views: number }[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, views: map.get(key) ?? 0 });
  }
  return result;
}

analyticsRoutes.get("/videos/:id/analytics", requireAuth, async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const parsed = rangeSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) throw new ValidationError("Invalid range");
  const { days, since } = rangeToInterval(parsed.data.range);

  const [v] = await db
    .select({
      id: video.id,
      userId: video.userId,
      title: video.title,
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      dislikeCount: video.dislikeCount,
      commentCount: video.commentCount,
    })
    .from(video)
    .where(eq(video.id, id))
    .limit(1);
  if (!v) throw new NotFoundError("Video");
  if (v.userId !== userId) throw new ForbiddenError();

  const dayRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${viewEvent.viewedAt}), 'YYYY-MM-DD')`,
      views: sql<number>`count(*)::int`,
    })
    .from(viewEvent)
    .where(and(eq(viewEvent.videoId, id), gte(viewEvent.viewedAt, since)))
    .groupBy(sql`date_trunc('day', ${viewEvent.viewedAt})`);

  const [rangeViews] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(viewEvent)
    .where(and(eq(viewEvent.videoId, id), gte(viewEvent.viewedAt, since)));

  return c.json({
    range: parsed.data.range,
    video: {
      id: v.id,
      title: v.title,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      dislikeCount: v.dislikeCount,
      commentCount: v.commentCount,
    },
    rangeViews: rangeViews?.count ?? 0,
    viewsByDay: fillByDay(dayRows, days),
  });
});

analyticsRoutes.get("/creator/analytics", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const parsed = rangeSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) throw new ValidationError("Invalid range");
  const { days, since } = rangeToInterval(parsed.data.range);

  const dayRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${viewEvent.viewedAt}), 'YYYY-MM-DD')`,
      views: sql<number>`count(*)::int`,
    })
    .from(viewEvent)
    .innerJoin(video, eq(video.id, viewEvent.videoId))
    .where(and(eq(video.userId, userId), gte(viewEvent.viewedAt, since)))
    .groupBy(sql`date_trunc('day', ${viewEvent.viewedAt})`);

  const [totals] = await db
    .select({
      totalViews: sql<number>`count(*)::int`,
    })
    .from(viewEvent)
    .innerJoin(video, eq(video.id, viewEvent.videoId))
    .where(and(eq(video.userId, userId), gte(viewEvent.viewedAt, since)));

  const topVideos = await db
    .select({
      id: video.id,
      title: video.title,
      thumbnailPath: video.thumbnailPath,
      viewsInRange: sql<number>`count(${viewEvent.id})::int`,
      totalViews: video.viewCount,
    })
    .from(video)
    .leftJoin(viewEvent, and(eq(viewEvent.videoId, video.id), gte(viewEvent.viewedAt, since)))
    .where(eq(video.userId, userId))
    .groupBy(video.id)
    .orderBy(desc(sql`count(${viewEvent.id})`))
    .limit(5);

  return c.json({
    range: parsed.data.range,
    rangeViews: totals?.totalViews ?? 0,
    viewsByDay: fillByDay(dayRows, days),
    topVideos: topVideos.map((v) => ({
      id: v.id,
      title: v.title,
      thumbnailUrl: v.thumbnailPath ? `/api/stream/${v.id}/thumbnail` : null,
      viewsInRange: v.viewsInRange,
      totalViews: v.totalViews,
    })),
  });
});
