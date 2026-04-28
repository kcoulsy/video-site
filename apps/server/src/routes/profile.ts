import { auth } from "@video-site/auth";
import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { playlist } from "@video-site/db/schema/playlist";
import { subscription } from "@video-site/db/schema/subscription";
import { video } from "@video-site/db/schema/video";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";

import { NotFoundError, ValidationError } from "../lib/errors";
import { detectThumbnailBuffer } from "../lib/file-validation";
import { activeAuthorWhere, visibleVideoWhere } from "../lib/moderation-filters";
import { storage } from "../lib/storage";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import type { AppVariables } from "../types";

export const profileRoutes = new Hono<{ Variables: AppVariables }>();

const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  handle: z
    .string()
    .transform((s) => s.toLowerCase())
    .refine((s) => HANDLE_RE.test(s), {
      message: "Handle must be 3-30 chars: lowercase letters, numbers, underscore",
    })
    .optional(),
  bio: z.string().max(500).optional(),
});

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function userImageUrl(
  userId: string,
  kind: "avatar" | "banner",
  path: string | null,
): string | null {
  if (!path) return null;
  return `/api/profile/${userId}/image/${kind}`;
}

profileRoutes.get("/profile/me", requireAuth, async (c) => {
  const currentUser = c.get("user");
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      handle: user.handle,
      bio: user.bio,
      image: user.image,
      bannerPath: user.bannerPath,
    })
    .from(user)
    .where(eq(user.id, currentUser.id))
    .limit(1);
  if (!row) throw new NotFoundError("User");

  return c.json({
    id: row.id,
    name: row.name,
    handle: row.handle,
    bio: row.bio,
    avatarUrl: userImageUrl(row.id, "avatar", row.image),
    bannerUrl: userImageUrl(row.id, "banner", row.bannerPath),
  });
});

profileRoutes.patch(
  "/profile/me",
  requireAuth,
  rateLimit({ name: "profile:update", limit: 20, windowSeconds: 600 }),
  async (c) => {
    const currentUser = c.get("user");
    const body = await c.req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
    }

    if (parsed.data.handle) {
      const [taken] = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.handle, parsed.data.handle), sql`${user.id} <> ${currentUser.id}`))
        .limit(1);
      if (taken) {
        return c.json({ error: "Handle already taken", code: "HANDLE_TAKEN" }, 409);
      }
    }

    const fields: Partial<typeof user.$inferInsert> = {};
    if (parsed.data.name !== undefined) fields.name = parsed.data.name;
    if (parsed.data.handle !== undefined) fields.handle = parsed.data.handle;
    if (parsed.data.bio !== undefined) fields.bio = parsed.data.bio;

    if (Object.keys(fields).length > 0) {
      await db.update(user).set(fields).where(eq(user.id, currentUser.id));
    }

    return c.json({ ok: true });
  },
);

async function handleImageUpload(
  c: Context<{ Variables: AppVariables }>,
  kind: "avatar" | "banner",
) {
  const currentUser = c.get("user");
  const body = await c.req.parseBody();
  const file = body["image"] ?? body["file"];
  if (!(file instanceof File)) {
    throw new ValidationError("No image file provided");
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new ValidationError(`Image must be under ${MAX_IMAGE_SIZE / (1024 * 1024)}MB`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let detected;
  try {
    detected = await detectThumbnailBuffer(bytes);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : "Invalid image");
  }

  const ext = detected.ext === "jpeg" ? "jpg" : detected.ext;
  const savedPath = await storage.saveUserImage(currentUser.id, kind, bytes, ext);

  if (kind === "avatar") {
    await db.update(user).set({ image: savedPath }).where(eq(user.id, currentUser.id));
  } else {
    await db.update(user).set({ bannerPath: savedPath }).where(eq(user.id, currentUser.id));
  }

  return c.json({ ok: true, url: `/api/profile/${currentUser.id}/image/${kind}?v=${Date.now()}` });
}

const profileImageRateLimit = rateLimit({
  name: "profile:image",
  limit: 10,
  windowSeconds: 600,
});
profileRoutes.post("/profile/me/avatar", requireAuth, profileImageRateLimit, (c) =>
  handleImageUpload(c, "avatar"),
);
profileRoutes.post("/profile/me/banner", requireAuth, profileImageRateLimit, (c) =>
  handleImageUpload(c, "banner"),
);

profileRoutes.get("/profile/:userId/image/:kind", async (c) => {
  const userId = c.req.param("userId");
  const kind = c.req.param("kind");
  if (kind !== "avatar" && kind !== "banner") return c.notFound();

  const [row] = await db
    .select({ image: user.image, bannerPath: user.bannerPath })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return c.notFound();

  const filePath = kind === "avatar" ? row.image : row.bannerPath;
  if (!filePath) return c.notFound();

  if (/^https?:\/\//.test(filePath)) {
    return c.redirect(filePath, 302);
  }

  if (!(await storage.fileExists(filePath))) return c.notFound();

  const file = Bun.file(filePath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
});

profileRoutes.get("/profile/:handle", async (c) => {
  const handle = c.req.param("handle").toLowerCase();
  if (!HANDLE_RE.test(handle)) throw new NotFoundError("Profile");

  const [profileRows, session] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        handle: user.handle,
        bio: user.bio,
        image: user.image,
        bannerPath: user.bannerPath,
        createdAt: user.createdAt,
        bannedAt: user.bannedAt,
        suspendedUntil: user.suspendedUntil,
      })
      .from(user)
      .where(eq(user.handle, handle))
      .limit(1),
    auth.api.getSession({ headers: c.req.raw.headers }),
  ]);
  const row = profileRows[0];
  if (!row) throw new NotFoundError("Profile");
  if (row.bannedAt) throw new NotFoundError("Profile");
  if (row.suspendedUntil && row.suspendedUntil > new Date()) throw new NotFoundError("Profile");

  const viewerId = session?.user.id;
  const isOwner = viewerId === row.id;

  const [videos, counts, playlistCounts, subCounts, subExists] = await Promise.all([
    db
      .select({
        id: video.id,
        title: video.title,
        thumbnailPath: video.thumbnailPath,
        thumbnailStillIndex: video.thumbnailStillIndex,
        duration: video.duration,
        viewCount: video.viewCount,
        createdAt: video.createdAt,
      })
      .from(video)
      .where(
        and(
          eq(video.userId, row.id),
          eq(video.status, "ready"),
          eq(video.visibility, "public"),
          visibleVideoWhere(),
        ),
      )
      .orderBy(desc(video.createdAt))
      .limit(48),
    db
      .select({ videoCount: sql<number>`count(*)::int` })
      .from(video)
      .innerJoin(user, eq(user.id, video.userId))
      .where(
        and(
          eq(video.userId, row.id),
          eq(video.status, "ready"),
          eq(video.visibility, "public"),
          visibleVideoWhere(),
          activeAuthorWhere(),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(playlist)
      .where(
        and(
          eq(playlist.userId, row.id),
          isOwner ? sql`${playlist.visibility} <> 'private'` : eq(playlist.visibility, "public"),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscription)
      .where(eq(subscription.channelId, row.id)),
    viewerId && !isOwner
      ? db
          .select({ x: sql<number>`1` })
          .from(subscription)
          .where(and(eq(subscription.subscriberId, viewerId), eq(subscription.channelId, row.id)))
          .limit(1)
      : Promise.resolve([] as { x: number }[]),
  ]);

  const avatarUrl = userImageUrl(row.id, "avatar", row.image);
  const items = videos.map((v) => ({
    id: v.id,
    title: v.title,
    thumbnailUrl: v.thumbnailPath
      ? `/api/stream/${v.id}/thumbnail${v.thumbnailStillIndex == null ? "" : `?v=${v.thumbnailStillIndex}`}`
      : null,
    duration: v.duration,
    viewCount: v.viewCount,
    createdAt: v.createdAt,
    user: { id: row.id, name: row.name, image: avatarUrl },
  }));

  const viewerIsSubscribed = subExists.length > 0;

  c.header("Cache-Control", "private, max-age=30");
  return c.json({
    user: {
      id: row.id,
      name: row.name,
      handle: row.handle,
      bio: row.bio,
      avatarUrl,
      bannerUrl: userImageUrl(row.id, "banner", row.bannerPath),
      createdAt: row.createdAt,
    },
    videos: items,
    counts: {
      videos: counts[0]?.videoCount ?? 0,
      playlists: playlistCounts[0]?.count ?? 0,
      subscribers: subCounts[0]?.count ?? 0,
    },
    viewerIsSubscribed,
    isOwner,
  });
});
