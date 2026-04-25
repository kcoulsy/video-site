import { db } from "@video-site/db";
import { videoLike } from "@video-site/db/schema/like";
import { video } from "@video-site/db/schema/video";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { NotFoundError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

export const likeRoutes = new Hono<{ Variables: AppVariables }>();

async function ensureVideoExists(videoId: string) {
  const [row] = await db.select({ id: video.id }).from(video).where(eq(video.id, videoId)).limit(1);
  if (!row) {
    throw new NotFoundError("Video");
  }
}

likeRoutes.get("/:videoId/like", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  const existing = await db.query.videoLike.findFirst({
    where: and(eq(videoLike.userId, userId), eq(videoLike.videoId, videoId)),
  });

  return c.json({ type: existing?.type ?? null });
});

likeRoutes.post("/:videoId/like", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  await ensureVideoExists(videoId);

  let resultType: "like" | null = "like";

  await db.transaction(async (tx) => {
    const existing = await tx.query.videoLike.findFirst({
      where: and(eq(videoLike.userId, userId), eq(videoLike.videoId, videoId)),
    });

    if (!existing) {
      await tx.insert(videoLike).values({ userId, videoId, type: "like" });
      await tx
        .update(video)
        .set({ likeCount: sql`${video.likeCount} + 1` })
        .where(eq(video.id, videoId));
      resultType = "like";
    } else if (existing.type === "like") {
      await tx
        .delete(videoLike)
        .where(and(eq(videoLike.userId, userId), eq(videoLike.videoId, videoId)));
      await tx
        .update(video)
        .set({ likeCount: sql`GREATEST(${video.likeCount} - 1, 0)` })
        .where(eq(video.id, videoId));
      resultType = null;
    } else {
      await tx
        .update(videoLike)
        .set({ type: "like", createdAt: new Date() })
        .where(and(eq(videoLike.userId, userId), eq(videoLike.videoId, videoId)));
      await tx
        .update(video)
        .set({
          likeCount: sql`${video.likeCount} + 1`,
          dislikeCount: sql`GREATEST(${video.dislikeCount} - 1, 0)`,
        })
        .where(eq(video.id, videoId));
      resultType = "like";
    }
  });

  return c.json({ type: resultType });
});

likeRoutes.post("/:videoId/dislike", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  await ensureVideoExists(videoId);

  let resultType: "dislike" | null = "dislike";

  await db.transaction(async (tx) => {
    const existing = await tx.query.videoLike.findFirst({
      where: and(eq(videoLike.userId, userId), eq(videoLike.videoId, videoId)),
    });

    if (!existing) {
      await tx.insert(videoLike).values({ userId, videoId, type: "dislike" });
      await tx
        .update(video)
        .set({ dislikeCount: sql`${video.dislikeCount} + 1` })
        .where(eq(video.id, videoId));
      resultType = "dislike";
    } else if (existing.type === "dislike") {
      await tx
        .delete(videoLike)
        .where(and(eq(videoLike.userId, userId), eq(videoLike.videoId, videoId)));
      await tx
        .update(video)
        .set({ dislikeCount: sql`GREATEST(${video.dislikeCount} - 1, 0)` })
        .where(eq(video.id, videoId));
      resultType = null;
    } else {
      await tx
        .update(videoLike)
        .set({ type: "dislike", createdAt: new Date() })
        .where(and(eq(videoLike.userId, userId), eq(videoLike.videoId, videoId)));
      await tx
        .update(video)
        .set({
          dislikeCount: sql`${video.dislikeCount} + 1`,
          likeCount: sql`GREATEST(${video.likeCount} - 1, 0)`,
        })
        .where(eq(video.id, videoId));
      resultType = "dislike";
    }
  });

  return c.json({ type: resultType });
});
