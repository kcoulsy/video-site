import { auth } from "@video-site/auth";
import { db, generateId } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { comment } from "@video-site/db/schema/comment";
import { commentLike } from "@video-site/db/schema/comment-like";
import { video } from "@video-site/db/schema/video";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { activeAuthorWhere } from "../lib/moderation-filters";
import { enqueueNotification } from "../lib/queue";
import { getRedisClient } from "../lib/redis";
import { requireActiveUser, requireNotMuted } from "../middleware/require-active-user";
import type { AppVariables } from "../types";

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

const MENTION_RE = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,30})/g;

async function notifyMentions(
  content: string,
  authorId: string,
  videoId: string,
  commentId: string,
) {
  const handles = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(content)) !== null) {
    handles.add(match[1]!.toLowerCase());
  }
  if (handles.size === 0) return;

  const recipients = await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.handle, [...handles]));

  for (const r of recipients) {
    if (r.id === authorId) continue;
    await enqueueNotification({
      type: "single",
      recipientId: r.id,
      kind: "mention",
      actorId: authorId,
      videoId,
      commentId,
    });
  }
}

async function checkRateLimit(userId: string) {
  const redis = getRedisClient();
  const key = `comment-rate:${userId}`;
  const result = await redis.multi().incr(key).expire(key, 60).exec();
  const count = result?.[0]?.[1] as number | undefined;
  if (count !== undefined && count > RATE_LIMIT_PER_MINUTE) {
    throw new AppError(429, "Rate limit exceeded", "RATE_LIMITED");
  }
}

function serializeComment(
  row: typeof comment.$inferSelect & {
    user: { id: string; name: string; image: string | null; handle: string | null };
    liked?: boolean;
  },
) {
  const isDeleted = row.deletedAt != null;
  const isRemoved = row.removedBy != null;
  return {
    id: row.id,
    content: isRemoved ? "[removed]" : isDeleted ? "[deleted]" : row.content,
    user: row.user,
    parentId: row.parentId,
    rootId: row.rootId,
    depth: row.depth,
    replyCount: row.replyCount,
    likeCount: row.likeCount,
    liked: row.liked ?? false,
    pinnedAt: row.pinnedAt,
    creatorHeartedAt: row.creatorHeartedAt,
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
  currentUserId?: string,
  pinnedFirst = false,
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

  const dateOrder = sort === "oldest" ? asc(comment.createdAt) : desc(comment.createdAt);
  const orderBy = pinnedFirst ? [sql`${comment.pinnedAt} DESC NULLS LAST`, dateOrder] : [dateOrder];

  const rows = await db
    .select({
      c: comment,
      userId: user.id,
      userName: user.name,
      userImage: user.image,
      userHandle: user.handle,
    })
    .from(comment)
    .innerJoin(user, eq(user.id, comment.userId))
    .where(and(...where, activeAuthorWhere()))
    .orderBy(...orderBy)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  let likedSet: Set<string> = new Set();
  if (currentUserId && slice.length > 0) {
    const ids = slice.map((r) => r.c.id);
    const likedRows = await db
      .select({ commentId: commentLike.commentId })
      .from(commentLike)
      .where(and(eq(commentLike.userId, currentUserId), inArray(commentLike.commentId, ids)));
    likedSet = new Set(likedRows.map((r) => r.commentId));
  }

  const items = slice.map((r) =>
    serializeComment({
      ...r.c,
      user: { id: r.userId, name: r.userName, image: r.userImage, handle: r.userHandle },
      liked: likedSet.has(r.c.id),
    }),
  );

  return {
    comments: items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    hasMore,
  };
}

commentRoutes.get("/videos/:videoId/comments", async (c) => {
  const videoId = c.req.param("videoId");
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const result = await listComments(
    [eq(comment.videoId, videoId), isNull(comment.parentId)],
    parsed.data.sort,
    parsed.data.limit,
    parsed.data.cursor,
    session?.user.id,
    true,
  );

  return c.json(result);
});

commentRoutes.get("/videos/:videoId/comments/:id/replies", async (c) => {
  const videoId = c.req.param("videoId");
  const parentId = c.req.param("id");
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const result = await listComments(
    [eq(comment.videoId, videoId), eq(comment.rootId, parentId)],
    "oldest",
    parsed.data.limit,
    parsed.data.cursor,
    session?.user.id,
  );

  return c.json(result);
});

commentRoutes.post("/videos/:videoId/comments", ...requireNotMuted, async (c) => {
  const videoId = c.req.param("videoId");
  const currentUser = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
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
      rootId: null,
      depth: 0,
    });
    await tx
      .update(video)
      .set({ commentCount: sql`${video.commentCount} + 1` })
      .where(eq(video.id, videoId));
  });

  await notifyMentions(parsed.data.content, currentUser.id, videoId, id);

  return c.json(
    serializeComment({
      id,
      content: parsed.data.content,
      userId: currentUser.id,
      videoId,
      parentId: null,
      rootId: null,
      depth: 0,
      replyCount: 0,
      likeCount: 0,
      pinnedAt: null,
      creatorHeartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      editedAt: null,
      deletedAt: null,
      removedBy: null,
      removalReason: null,
      reviewedAt: null,
      reviewedBy: null,
      user: {
        id: currentUser.id,
        name: currentUser.name,
        image: currentUser.image ?? null,
        handle: currentUser.handle ?? null,
      },
    }),
    201,
  );
});

commentRoutes.post("/videos/:videoId/comments/:id/replies", ...requireNotMuted, async (c) => {
  const videoId = c.req.param("videoId");
  const parentId = c.req.param("id");
  const currentUser = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const [parent] = await db
    .select({
      id: comment.id,
      depth: comment.depth,
      videoId: comment.videoId,
      rootId: comment.rootId,
      userId: comment.userId,
    })
    .from(comment)
    .where(eq(comment.id, parentId))
    .limit(1);
  if (!parent || parent.videoId !== videoId) {
    throw new NotFoundError("Parent comment");
  }

  await checkRateLimit(currentUser.id);

  const rootId = parent.depth === 0 ? parent.id : (parent.rootId ?? parent.id);
  const id = generateId();

  let rootOwnerId = parent.userId;
  await db.transaction(async (tx) => {
    if (rootId !== parent.id) {
      const [rootRow] = await tx
        .select({ userId: comment.userId })
        .from(comment)
        .where(eq(comment.id, rootId))
        .limit(1);
      if (rootRow) rootOwnerId = rootRow.userId;
    }

    await tx.insert(comment).values({
      id,
      content: parsed.data.content,
      userId: currentUser.id,
      videoId,
      parentId: rootId,
      rootId,
      depth: 1,
    });
    await tx
      .update(comment)
      .set({ replyCount: sql`${comment.replyCount} + 1` })
      .where(eq(comment.id, rootId));
    await tx
      .update(video)
      .set({ commentCount: sql`${video.commentCount} + 1` })
      .where(eq(video.id, videoId));
  });

  if (rootOwnerId !== currentUser.id) {
    await enqueueNotification({
      type: "single",
      recipientId: rootOwnerId,
      kind: "comment_reply",
      actorId: currentUser.id,
      videoId,
      commentId: id,
    });
  }

  await notifyMentions(parsed.data.content, currentUser.id, videoId, id);

  return c.json(
    serializeComment({
      id,
      content: parsed.data.content,
      userId: currentUser.id,
      videoId,
      parentId: rootId,
      rootId,
      depth: 1,
      replyCount: 0,
      likeCount: 0,
      pinnedAt: null,
      creatorHeartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      editedAt: null,
      deletedAt: null,
      removedBy: null,
      removalReason: null,
      reviewedAt: null,
      reviewedBy: null,
      user: {
        id: currentUser.id,
        name: currentUser.name,
        image: currentUser.image ?? null,
        handle: currentUser.handle ?? null,
      },
    }),
    201,
  );
});

commentRoutes.patch("/comments/:id", ...requireActiveUser, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
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

commentRoutes.delete("/comments/:id", ...requireActiveUser, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  const [existing] = await db
    .select({
      userId: comment.userId,
      videoId: comment.videoId,
      parentId: comment.parentId,
      rootId: comment.rootId,
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

    const rootForCount = existing.rootId ?? existing.parentId;
    if (rootForCount) {
      await tx
        .update(comment)
        .set({
          replyCount: sql`GREATEST(${comment.replyCount} - 1, 0)`,
        })
        .where(eq(comment.id, rootForCount));
    }
  });

  return c.json({ ok: true });
});

async function ensureVideoOwner(commentId: string, userId: string) {
  const [row] = await db
    .select({
      id: comment.id,
      videoId: comment.videoId,
      ownerId: video.userId,
    })
    .from(comment)
    .innerJoin(video, eq(video.id, comment.videoId))
    .where(eq(comment.id, commentId))
    .limit(1);
  if (!row) throw new NotFoundError("Comment");
  if (row.ownerId !== userId) throw new ForbiddenError();
  return row;
}

commentRoutes.post("/comments/:id/pin", ...requireActiveUser, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  const { videoId } = await ensureVideoOwner(id, currentUser.id);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(comment)
      .set({ pinnedAt: null })
      .where(and(eq(comment.videoId, videoId), sql`${comment.pinnedAt} IS NOT NULL`));
    await tx.update(comment).set({ pinnedAt: now }).where(eq(comment.id, id));
  });
  return c.json({ pinnedAt: now });
});

commentRoutes.delete("/comments/:id/pin", ...requireActiveUser, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  await ensureVideoOwner(id, currentUser.id);
  await db.update(comment).set({ pinnedAt: null }).where(eq(comment.id, id));
  return c.json({ pinnedAt: null });
});

commentRoutes.post("/comments/:id/heart", ...requireActiveUser, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  await ensureVideoOwner(id, currentUser.id);
  const now = new Date();
  await db.update(comment).set({ creatorHeartedAt: now }).where(eq(comment.id, id));
  return c.json({ creatorHeartedAt: now });
});

commentRoutes.delete("/comments/:id/heart", ...requireActiveUser, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  await ensureVideoOwner(id, currentUser.id);
  await db.update(comment).set({ creatorHeartedAt: null }).where(eq(comment.id, id));
  return c.json({ creatorHeartedAt: null });
});
