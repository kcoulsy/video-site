import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { subscription } from "@video-site/db/schema/subscription";
import { video } from "@video-site/db/schema/video";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { ForbiddenError, NotFoundError } from "../lib/errors";
import { activeAuthorWhere, visibleVideoWhere } from "../lib/moderation-filters";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

export const subscriptionRoutes = new Hono<{ Variables: AppVariables }>();

async function resolveChannel(handle: string) {
  const [row] = await db
    .select({ id: user.id, name: user.name, handle: user.handle, image: user.image })
    .from(user)
    .where(eq(user.handle, handle.toLowerCase()))
    .limit(1);
  if (!row) throw new NotFoundError("Channel");
  return row;
}

subscriptionRoutes.post("/channels/:handle/subscribe", requireAuth, async (c) => {
  const handle = c.req.param("handle");
  const me = c.get("user").id;
  const channel = await resolveChannel(handle);
  if (channel.id === me) throw new ForbiddenError("Cannot subscribe to yourself");

  await db
    .insert(subscription)
    .values({ subscriberId: me, channelId: channel.id })
    .onConflictDoNothing({ target: [subscription.subscriberId, subscription.channelId] });
  return c.json({ subscribed: true });
});

subscriptionRoutes.delete("/channels/:handle/subscribe", requireAuth, async (c) => {
  const handle = c.req.param("handle");
  const me = c.get("user").id;
  const channel = await resolveChannel(handle);

  await db
    .delete(subscription)
    .where(and(eq(subscription.subscriberId, me), eq(subscription.channelId, channel.id)));
  return c.json({ subscribed: false });
});

subscriptionRoutes.get("/me/subscriptions", requireAuth, async (c) => {
  const me = c.get("user").id;
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const page = Math.max(1, Math.min(500, Number(params.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 50));
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      handle: user.handle,
      image: user.image,
      since: subscription.createdAt,
      total: sql<number>`COUNT(*) OVER()::int`,
    })
    .from(subscription)
    .innerJoin(user, eq(user.id, subscription.channelId))
    .where(eq(subscription.subscriberId, me))
    .orderBy(desc(subscription.createdAt))
    .limit(limit)
    .offset(offset);

  const total = rows[0]?.total ?? 0;
  const items = rows.map(({ total: _t, ...rest }) => {
    void _t;
    return rest;
  });

  return c.json({
    items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

subscriptionRoutes.get("/me/subscriptions/feed", requireAuth, async (c) => {
  const me = c.get("user").id;
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const page = Math.max(1, Math.min(500, Number(params.page) || 1));
  const limit = Math.max(1, Math.min(50, Number(params.limit) || 24));
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: video.id,
      title: video.title,
      thumbnailPath: video.thumbnailPath,
      thumbnailStillIndex: video.thumbnailStillIndex,
      duration: video.duration,
      viewCount: video.viewCount,
      createdAt: video.createdAt,
      publishedAt: video.publishedAt,
      ownerId: user.id,
      ownerName: user.name,
      ownerHandle: user.handle,
      ownerImage: user.image,
      total: sql<number>`COUNT(*) OVER()::int`,
    })
    .from(subscription)
    .innerJoin(video, eq(video.userId, subscription.channelId))
    .innerJoin(user, eq(user.id, video.userId))
    .where(
      and(
        eq(subscription.subscriberId, me),
        eq(video.visibility, "public"),
        eq(video.status, "ready"),
        visibleVideoWhere(),
        activeAuthorWhere(),
      ),
    )
    .orderBy(desc(sql`COALESCE(${video.publishedAt}, ${video.createdAt})`))
    .limit(limit)
    .offset(offset);

  const total = rows[0]?.total ?? 0;
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      thumbnailUrl: r.thumbnailPath
        ? `/api/stream/${r.id}/thumbnail${r.thumbnailStillIndex == null ? "" : `?v=${r.thumbnailStillIndex}`}`
        : null,
      duration: r.duration,
      viewCount: r.viewCount,
      createdAt: r.createdAt,
      publishedAt: r.publishedAt,
      user: {
        id: r.ownerId,
        name: r.ownerName,
        handle: r.ownerHandle,
        image: r.ownerImage,
      },
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});
