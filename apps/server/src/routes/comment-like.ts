import { db } from "@video-site/db";
import { comment } from "@video-site/db/schema/comment";
import { commentLike } from "@video-site/db/schema/comment-like";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { NotFoundError } from "../lib/errors";
import { enqueueNotification } from "../lib/queue";
import { rateLimit } from "../middleware/rate-limit";
import { requireNotMuted } from "../middleware/require-active-user";
import type { AppVariables } from "../types";

export const commentLikeRoutes = new Hono<{ Variables: AppVariables }>();

commentLikeRoutes.post(
  "/comments/:commentId/like",
  ...requireNotMuted,
  rateLimit({ name: "comment:like", limit: 60, windowSeconds: 60 }),
  async (c) => {
    const userId = c.get("user").id;
    const commentId = c.req.param("commentId");

    const [existingComment] = await db
      .select({
        id: comment.id,
        ownerId: comment.userId,
        videoId: comment.videoId,
        deletedAt: comment.deletedAt,
        removedBy: comment.removedBy,
      })
      .from(comment)
      .where(eq(comment.id, commentId))
      .limit(1);
    if (!existingComment || existingComment.deletedAt || existingComment.removedBy) {
      throw new NotFoundError("Comment");
    }

    let liked = false;
    let likeCount = 0;

    await db.transaction(async (tx) => {
      const existing = await tx.query.commentLike.findFirst({
        where: and(eq(commentLike.userId, userId), eq(commentLike.commentId, commentId)),
      });

      if (!existing) {
        await tx.insert(commentLike).values({ userId, commentId });
        const [updated] = await tx
          .update(comment)
          .set({ likeCount: sql`${comment.likeCount} + 1` })
          .where(eq(comment.id, commentId))
          .returning({ likeCount: comment.likeCount });
        liked = true;
        likeCount = updated?.likeCount ?? 0;
      } else {
        await tx
          .delete(commentLike)
          .where(and(eq(commentLike.userId, userId), eq(commentLike.commentId, commentId)));
        const [updated] = await tx
          .update(comment)
          .set({ likeCount: sql`GREATEST(${comment.likeCount} - 1, 0)` })
          .where(eq(comment.id, commentId))
          .returning({ likeCount: comment.likeCount });
        liked = false;
        likeCount = updated?.likeCount ?? 0;
      }
    });

    if (liked && existingComment.ownerId !== userId) {
      await enqueueNotification({
        type: "single",
        recipientId: existingComment.ownerId,
        kind: "comment_like",
        actorId: userId,
        videoId: existingComment.videoId,
        commentId,
        coalesceWindowSec: 3600,
      });
    }

    return c.json({ liked, likeCount });
  },
);
