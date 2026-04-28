import { auth } from "@video-site/auth";
import { db, generateId } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { playlist, playlistItem } from "@video-site/db/schema/playlist";
import { video } from "@video-site/db/schema/video";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { activeAuthorWhere, visibleVideoWhere } from "../lib/moderation-filters";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

export const playlistRoutes = new Hono<{ Variables: AppVariables }>();

const visibilitySchema = z.enum(["public", "unlisted", "private"]);

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  visibility: visibilitySchema.default("private"),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: visibilitySchema.optional(),
});

const addItemSchema = z.object({ videoId: z.string().min(1) });
const reorderSchema = z.object({ position: z.number().int().nonnegative() });

playlistRoutes.get("/playlists", async (c) => {
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const page = Math.max(1, Math.min(500, Number(params.page) || 1));
  const limit = Math.max(1, Math.min(50, Number(params.limit) || 24));
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      visibility: playlist.visibility,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      ownerId: user.id,
      ownerName: user.name,
      ownerHandle: user.handle,
      ownerImage: user.image,
      itemCount: sql<number>`COALESCE(pl_summary.count, 0)::int`,
      thumbVideoId: sql<string | null>`pl_summary.first_video_id`,
      total: sql<number>`COUNT(*) OVER()::int`,
    })
    .from(playlist)
    .innerJoin(user, eq(user.id, playlist.userId))
    .leftJoin(
      sql`LATERAL (
        SELECT COUNT(*) AS count,
               (SELECT ${playlistItem.videoId} FROM ${playlistItem}
                WHERE ${playlistItem.playlistId} = ${playlist.id}
                ORDER BY ${playlistItem.position} ASC LIMIT 1) AS first_video_id
        FROM ${playlistItem}
        WHERE ${playlistItem.playlistId} = ${playlist.id}
      ) AS pl_summary`,
      sql`true`,
    )
    .where(and(eq(playlist.visibility, "public"), activeAuthorWhere()))
    .orderBy(desc(playlist.updatedAt))
    .limit(limit)
    .offset(offset);

  const total = rows[0]?.total ?? 0;
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      visibility: r.visibility,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      itemCount: r.itemCount,
      thumbnailUrl: r.thumbVideoId ? `/api/stream/${r.thumbVideoId}/thumbnail` : null,
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

playlistRoutes.get("/users/:handle/playlists", async (c) => {
  const handle = c.req.param("handle").toLowerCase();
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const page = Math.max(1, Math.min(500, Number(params.page) || 1));
  const limit = Math.max(1, Math.min(50, Number(params.limit) || 48));
  const offset = (page - 1) * limit;

  const [ownerRows, session] = await Promise.all([
    db.select({ id: user.id }).from(user).where(eq(user.handle, handle)).limit(1),
    auth.api.getSession({ headers: c.req.raw.headers }),
  ]);
  const owner = ownerRows[0];
  if (!owner) throw new NotFoundError("Profile");

  const isOwner = session?.user.id === owner.id;
  const visWhere = isOwner
    ? sql`${playlist.visibility} <> 'private'`
    : eq(playlist.visibility, "public");

  const rows = await db
    .select({
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      visibility: playlist.visibility,
      updatedAt: playlist.updatedAt,
      itemCount: sql<number>`COALESCE(pl_summary.count, 0)::int`,
      thumbVideoId: sql<string | null>`pl_summary.first_video_id`,
      total: sql<number>`COUNT(*) OVER()::int`,
    })
    .from(playlist)
    .leftJoin(
      sql`LATERAL (
        SELECT COUNT(*) AS count,
               (SELECT ${playlistItem.videoId} FROM ${playlistItem}
                WHERE ${playlistItem.playlistId} = ${playlist.id}
                ORDER BY ${playlistItem.position} ASC LIMIT 1) AS first_video_id
        FROM ${playlistItem}
        WHERE ${playlistItem.playlistId} = ${playlist.id}
      ) AS pl_summary`,
      sql`true`,
    )
    .where(and(eq(playlist.userId, owner.id), visWhere))
    .orderBy(desc(playlist.updatedAt))
    .limit(limit)
    .offset(offset);

  const total = rows[0]?.total ?? 0;
  return c.json({
    items: rows.map(({ total: _t, ...r }) => {
      void _t;
      return {
        ...r,
        thumbnailUrl: r.thumbVideoId ? `/api/stream/${r.thumbVideoId}/thumbnail` : null,
      };
    }),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

playlistRoutes.get("/playlists/mine", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const page = Math.max(1, Math.min(500, Number(params.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 48));
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      visibility: playlist.visibility,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      itemCount: sql<number>`COALESCE(pl_summary.count, 0)::int`,
      thumbVideoId: sql<string | null>`pl_summary.first_video_id`,
      total: sql<number>`COUNT(*) OVER()::int`,
    })
    .from(playlist)
    .leftJoin(
      sql`LATERAL (
        SELECT COUNT(*) AS count,
               (SELECT ${playlistItem.videoId} FROM ${playlistItem}
                WHERE ${playlistItem.playlistId} = ${playlist.id}
                ORDER BY ${playlistItem.position} ASC LIMIT 1) AS first_video_id
        FROM ${playlistItem}
        WHERE ${playlistItem.playlistId} = ${playlist.id}
      ) AS pl_summary`,
      sql`true`,
    )
    .where(eq(playlist.userId, userId))
    .orderBy(desc(playlist.updatedAt))
    .limit(limit)
    .offset(offset);

  const total = rows[0]?.total ?? 0;
  return c.json({
    items: rows.map(({ total: _t, ...r }) => {
      void _t;
      return {
        ...r,
        thumbnailUrl: r.thumbVideoId ? `/api/stream/${r.thumbVideoId}/thumbnail` : null,
      };
    }),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

playlistRoutes.get("/playlists/contains/:videoId", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  const rows = await db
    .select({
      id: playlist.id,
      title: playlist.title,
      visibility: playlist.visibility,
      contains: sql<boolean>`EXISTS (SELECT 1 FROM ${playlistItem} WHERE ${playlistItem.playlistId} = ${playlist.id} AND ${playlistItem.videoId} = ${videoId})`,
    })
    .from(playlist)
    .where(eq(playlist.userId, userId))
    .orderBy(desc(playlist.updatedAt))
    .limit(100);

  return c.json({ items: rows });
});

playlistRoutes.post("/playlists", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const id = generateId();
  await db.insert(playlist).values({
    id,
    userId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    visibility: parsed.data.visibility,
  });
  return c.json({ id }, 201);
});

playlistRoutes.get("/playlists/:id", async (c) => {
  const id = c.req.param("id");
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const currentUserId = session?.user.id;

  const [row] = await db
    .select({
      p: playlist,
      ownerName: user.name,
      ownerImage: user.image,
    })
    .from(playlist)
    .innerJoin(user, eq(user.id, playlist.userId))
    .where(eq(playlist.id, id))
    .limit(1);

  if (!row) {
    throw new NotFoundError("Playlist");
  }

  const isOwner = currentUserId === row.p.userId;
  if (row.p.visibility === "private" && !isOwner) {
    throw new NotFoundError("Playlist");
  }

  const items = await db
    .select({
      videoId: playlistItem.videoId,
      position: playlistItem.position,
      addedAt: playlistItem.addedAt,
      videoTitle: video.title,
      videoThumbnailPath: video.thumbnailPath,
      videoDuration: video.duration,
      videoViewCount: video.viewCount,
      videoCreatedAt: video.createdAt,
      videoStatus: video.status,
      ownerId: user.id,
      ownerName: user.name,
      ownerImage: user.image,
    })
    .from(playlistItem)
    .innerJoin(video, eq(video.id, playlistItem.videoId))
    .innerJoin(user, eq(user.id, video.userId))
    .where(and(eq(playlistItem.playlistId, id), visibleVideoWhere(), activeAuthorWhere()))
    .orderBy(asc(playlistItem.position));

  return c.json({
    id: row.p.id,
    title: row.p.title,
    description: row.p.description,
    visibility: row.p.visibility,
    createdAt: row.p.createdAt,
    updatedAt: row.p.updatedAt,
    isOwner,
    user: { id: row.p.userId, name: row.ownerName, image: row.ownerImage },
    items: items.map((it) => ({
      videoId: it.videoId,
      position: it.position,
      addedAt: it.addedAt,
      video: {
        id: it.videoId,
        title: it.videoTitle,
        thumbnailUrl: it.videoThumbnailPath ? `/api/stream/${it.videoId}/thumbnail` : null,
        duration: it.videoDuration,
        viewCount: it.videoViewCount,
        createdAt: it.videoCreatedAt,
        status: it.videoStatus,
        user: { id: it.ownerId, name: it.ownerName, image: it.ownerImage },
      },
    })),
  });
});

async function ensureOwnPlaylist(playlistId: string, userId: string) {
  const [row] = await db
    .select({ userId: playlist.userId })
    .from(playlist)
    .where(eq(playlist.id, playlistId))
    .limit(1);
  if (!row) throw new NotFoundError("Playlist");
  if (row.userId !== userId) throw new ForbiddenError();
}

playlistRoutes.patch("/playlists/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  await ensureOwnPlaylist(id, userId);

  const fields: Partial<typeof playlist.$inferInsert> = {};
  if (parsed.data.title !== undefined) fields.title = parsed.data.title;
  if (parsed.data.description !== undefined) fields.description = parsed.data.description;
  if (parsed.data.visibility !== undefined) fields.visibility = parsed.data.visibility;

  if (Object.keys(fields).length > 0) {
    await db.update(playlist).set(fields).where(eq(playlist.id, id));
  }
  return c.json({ ok: true });
});

playlistRoutes.delete("/playlists/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  await ensureOwnPlaylist(id, userId);
  await db.delete(playlist).where(eq(playlist.id, id));
  return c.json({ ok: true });
});

playlistRoutes.post("/playlists/:id/items", requireAuth, async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  const parsed = addItemSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  await ensureOwnPlaylist(id, userId);

  const [v] = await db
    .select({ id: video.id })
    .from(video)
    .where(eq(video.id, parsed.data.videoId))
    .limit(1);
  if (!v) throw new NotFoundError("Video");

  await db.transaction(async (tx) => {
    const maxRows = await tx
      .select({ maxPos: sql<number | null>`MAX(${playlistItem.position})` })
      .from(playlistItem)
      .where(eq(playlistItem.playlistId, id));
    const nextPos = (maxRows[0]?.maxPos ?? -1) + 1;

    await tx
      .insert(playlistItem)
      .values({ playlistId: id, videoId: parsed.data.videoId, position: nextPos })
      .onConflictDoNothing({ target: [playlistItem.playlistId, playlistItem.videoId] });
    await tx.update(playlist).set({ updatedAt: new Date() }).where(eq(playlist.id, id));
  });

  return c.json({ ok: true });
});

playlistRoutes.delete("/playlists/:id/items/:videoId", requireAuth, async (c) => {
  const id = c.req.param("id");
  const videoId = c.req.param("videoId");
  const userId = c.get("user").id;
  await ensureOwnPlaylist(id, userId);

  await db
    .delete(playlistItem)
    .where(and(eq(playlistItem.playlistId, id), eq(playlistItem.videoId, videoId)));
  await db.update(playlist).set({ updatedAt: new Date() }).where(eq(playlist.id, id));
  return c.json({ ok: true });
});

playlistRoutes.patch("/playlists/:id/items/:videoId", requireAuth, async (c) => {
  const id = c.req.param("id");
  const videoId = c.req.param("videoId");
  const userId = c.get("user").id;
  const body = await c.req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }
  await ensureOwnPlaylist(id, userId);

  await db.transaction(async (tx) => {
    const items = await tx
      .select({ videoId: playlistItem.videoId, position: playlistItem.position })
      .from(playlistItem)
      .where(eq(playlistItem.playlistId, id))
      .orderBy(asc(playlistItem.position));

    const target = items.find((it) => it.videoId === videoId);
    if (!target) throw new NotFoundError("Item");

    const filtered = items.filter((it) => it.videoId !== videoId);
    const targetIdx = Math.max(0, Math.min(parsed.data.position, filtered.length));
    filtered.splice(targetIdx, 0, target);

    for (let i = 0; i < filtered.length; i++) {
      const it = filtered[i]!;
      await tx
        .update(playlistItem)
        .set({ position: i })
        .where(and(eq(playlistItem.playlistId, id), eq(playlistItem.videoId, it.videoId)));
    }
    await tx.update(playlist).set({ updatedAt: new Date() }).where(eq(playlist.id, id));
  });

  return c.json({ ok: true });
});
