import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { comment } from "@video-site/db/schema/comment";
import { notification } from "@video-site/db/schema/notification";
import { video } from "@video-site/db/schema/video";
import { aliasedTable, and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { ValidationError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

export const notificationRoutes = new Hono<{ Variables: AppVariables }>();

const listSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

const readSchema = z.object({
  ids: z.union([z.array(z.string()).min(1).max(200), z.literal("all")]),
});

const actor = aliasedTable(user, "actor");

notificationRoutes.get("/notifications/unread-count", requireAuth, async (c) => {
  const me = c.get("user").id;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.recipientId, me), isNull(notification.readAt)));
  return c.json({ count: row?.count ?? 0 });
});

notificationRoutes.get("/notifications", requireAuth, async (c) => {
  const me = c.get("user").id;
  const parsed = listSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) throw new ValidationError("Invalid query");
  const { cursor, limit } = parsed.data;

  const conds = [eq(notification.recipientId, me)];
  if (cursor) {
    const [cursorRow] = await db
      .select({ createdAt: notification.createdAt })
      .from(notification)
      .where(eq(notification.id, cursor))
      .limit(1);
    if (cursorRow) {
      conds.push(lt(notification.createdAt, cursorRow.createdAt));
    }
  }

  const rows = await db
    .select({
      id: notification.id,
      kind: notification.kind,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      videoId: notification.videoId,
      commentId: notification.commentId,
      actorId: actor.id,
      actorName: actor.name,
      actorHandle: actor.handle,
      actorImage: actor.image,
      videoTitle: video.title,
      commentContent: comment.content,
    })
    .from(notification)
    .leftJoin(actor, eq(actor.id, notification.actorId))
    .leftJoin(video, eq(video.id, notification.videoId))
    .leftJoin(comment, eq(comment.id, notification.commentId))
    .where(and(...conds))
    .orderBy(desc(notification.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (slice[slice.length - 1]?.id ?? null) : null;

  return c.json({
    items: slice.map((r) => ({
      id: r.id,
      kind: r.kind,
      readAt: r.readAt,
      createdAt: r.createdAt,
      videoId: r.videoId,
      commentId: r.commentId,
      actor: r.actorId
        ? {
            id: r.actorId,
            name: r.actorName,
            handle: r.actorHandle,
            image: r.actorImage,
          }
        : null,
      videoTitle: r.videoTitle,
      commentSnippet: r.commentContent ? r.commentContent.slice(0, 140) : null,
    })),
    nextCursor,
    hasMore,
  });
});

notificationRoutes.post("/notifications/read", requireAuth, async (c) => {
  const me = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  const parsed = readSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");

  if (parsed.data.ids === "all") {
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.recipientId, me), isNull(notification.readAt)));
  } else {
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.recipientId, me),
          inArray(notification.id, parsed.data.ids),
          isNull(notification.readAt),
        ),
      );
  }
  return c.json({ ok: true });
});
