import { db, generateId } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { comment } from "@video-site/db/schema/comment";
import { video } from "@video-site/db/schema/video";
import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../lib/errors";
import { getRedisClient } from "../lib/redis";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

const MAX_DEPTH = 3;
const RATE_LIMIT_PER_MINUTE = 10;

const contentSchema = z
  .string()
  .trim()
  .min(1, "Comment cannot be empty")
  .max(2000, "Comment must be 2000 characters or fewer");

const createSchema = z.object({ content: contentSchema });

const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

async function checkRateLimit(userId: string) {
  const redis = getRedisClient();
  const key = `comment-rate:${userId}`;
  const result = await redis
    .multi()
    .incr(key)
    .expire(key, 60)
    .exec();
  const count = result?.[0]?.[1] as number | undefined;
  if (count !== undefined && count > RATE_LIMIT_PER_MINUTE) {
    throw new AppError(429, "Rate limit exceeded", "RATE_LIMITED");
  }
}

function serializeComment(
  row: typeof comment.$inferSelect & {
    user: { id: string; name: string; image: string | null };
  },
) {
  const isDeleted = row.deletedAt != null;
  return {
    id: row.id,
    content: isDeleted ? "[deleted]" : row.content,
    user: row.user,
    parentId: row.parentId,
    depth: row.depth,
    replyCount: row.replyCount,
    likeCount: row.likeCount,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
  };
}

export const commentRoutes = new Hono<{ Variables: AppVariables }>();

async function listComments(
  where: ReturnType<typeof eq>[],
  sort: "newest" | "oldest",
  limit: number,
  cursor?: string,
) {
  if (cursor) {
    const [cursorRow] = await db
      .select({ createdAt: comment.createdAt })
      .from(comment)
      .where(eq(comment.id, cursor))
      .limit(1);
    if (cursorRow) {
      where.push(
        sort === "newest"
          ? lt(comment.createdAt, cursorRow.createdAt)
          : (sql`${comment.createdAt} > ${cursorRow.createdAt}` as any),
      );
    }
  }

  const orderBy =
    sort === "oldest" ? asc(comment.createdAt) : desc(comment.createdAt);

  const rows = await db
    .select({
      c: comment,
      userId: user.id,
      userName: user.name,
      userImage: user.image,
    })
    .from(comment)
    .innerJoin(user, eq(user.id, comment.userId))
    .where(and(...where))
    .orderBy(orderBy)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const items = slice.map((r) =>
    serializeComment({
      ...r.c,
      user: { id: r.userId, name: r.userName, image: r.userImage },
    }),
  );

  return {
    comments: items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    hasMore,
  };
}

commentRoutes.get("/videos/:videoId/comments", async (c) => {
  const videoId = c.req.param("videoId");
  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }

  const result = await listComments(
    [eq(comment.videoId, videoId), isNull(comment.parentId)],
    parsed.data.sort,
    parsed.data.limit,
    parsed.data.cursor,
  );

  return c.json(result);
});

commentRoutes.get(
  "/videos/:videoId/comments/:id/replies",
  async (c) => {
    const videoId = c.req.param("videoId");
    const parentId = c.req.param("id");
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) {
      throw new ValidationError("Invalid query");
    }

    const result = await listComments(
      [eq(comment.videoId, videoId), eq(comment.parentId, parentId)],
      "oldest",
      parsed.data.limit,
      parsed.data.cursor,
    );

    return c.json(result);
  },
);

commentRoutes.post("/videos/:videoId/comments", requireAuth, async (c) => {
  const videoId = c.req.param("videoId");
  const currentUser = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid body",
    );
  }

  const [videoRow] = await db
    .select({ id: video.id })
    .from(video)
    .where(eq(video.id, videoId))
    .limit(1);
  if (!videoRow) {
    throw new NotFoundError("Video");
  }

  await checkRateLimit(currentUser.id);

  const id = generateId();
  await db.transaction(async (tx) => {
    await tx.insert(comment).values({
      id,
      content: parsed.data.content,
      userId: currentUser.id,
      videoId,
      parentId: null,
      depth: 0,
    });
    await tx
      .update(video)
      .set({ commentCount: sql`${video.commentCount} + 1` })
      .where(eq(video.id, videoId));
  });

  return c.json(
    serializeComment({
      id,
      content: parsed.data.content,
      userId: currentUser.id,
      videoId,
      parentId: null,
      depth: 0,
      replyCount: 0,
      likeCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      editedAt: null,
      deletedAt: null,
      user: {
        id: currentUser.id,
        name: currentUser.name,
        image: currentUser.image ?? null,
      },
    }),
    201,
  );
});

commentRoutes.post(
  "/videos/:videoId/comments/:id/replies",
  requireAuth,
  async (c) => {
    const videoId = c.req.param("videoId");
    const parentId = c.req.param("id");
    const currentUser = c.get("user");

    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid body",
      );
    }

    const [parent] = await db
      .select({ depth: comment.depth, videoId: comment.videoId })
      .from(comment)
      .where(eq(comment.id, parentId))
      .limit(1);
    if (!parent || parent.videoId !== videoId) {
      throw new NotFoundError("Parent comment");
    }

    await checkRateLimit(currentUser.id);

    const depth = Math.min(parent.depth + 1, MAX_DEPTH);
    const id = generateId();

    await db.transaction(async (tx) => {
      await tx.insert(comment).values({
        id,
        content: parsed.data.content,
        userId: currentUser.id,
        videoId,
        parentId,
        depth,
      });
      await tx
        .update(comment)
        .set({ replyCount: sql`${comment.replyCount} + 1` })
        .where(eq(comment.id, parentId));
      await tx
        .update(video)
        .set({ commentCount: sql`${video.commentCount} + 1` })
        .where(eq(video.id, videoId));
    });

    return c.json(
      serializeComment({
        id,
        content: parsed.data.content,
        userId: currentUser.id,
        videoId,
        parentId,
        depth,
        replyCount: 0,
        likeCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        editedAt: null,
        deletedAt: null,
        user: {
          id: currentUser.id,
          name: currentUser.name,
          image: currentUser.image ?? null,
        },
      }),
      201,
    );
  },
);

commentRoutes.patch("/comments/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid body",
    );
  }

  const [existing] = await db
    .select({
      userId: comment.userId,
      deletedAt: comment.deletedAt,
    })
    .from(comment)
    .where(eq(comment.id, id))
    .limit(1);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Comment");
  }
  if (existing.userId !== currentUser.id) {
    throw new ForbiddenError();
  }

  const editedAt = new Date();
  await db
    .update(comment)
    .set({ content: parsed.data.content, editedAt })
    .where(eq(comment.id, id));

  return c.json({ ok: true, editedAt });
});

commentRoutes.delete("/comments/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  const [existing] = await db
    .select({
      userId: comment.userId,
      videoId: comment.videoId,
      parentId: comment.parentId,
      replyCount: comment.replyCount,
      deletedAt: comment.deletedAt,
    })
    .from(comment)
    .where(eq(comment.id, id))
    .limit(1);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Comment");
  }
  if (existing.userId !== currentUser.id) {
    throw new ForbiddenError();
  }

  await db.transaction(async (tx) => {
    if (existing.replyCount > 0) {
      await tx
        .update(comment)
        .set({ content: "[deleted]", deletedAt: new Date() })
        .where(eq(comment.id, id));
    } else {
      await tx.delete(comment).where(eq(comment.id, id));
    }

    await tx
      .update(video)
      .set({ commentCount: sql`GREATEST(${video.commentCount} - 1, 0)` })
      .where(eq(video.id, existing.videoId));

    if (existing.parentId) {
      await tx
        .update(comment)
        .set({
          replyCount: sql`GREATEST(${comment.replyCount} - 1, 0)`,
        })
        .where(eq(comment.id, existing.parentId));
    }
  });

  return c.json({ ok: true });
});
