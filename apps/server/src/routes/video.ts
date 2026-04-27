import { auth } from "@video-site/auth";
import { db, generateId } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { category, categoryTag, tag, videoTag } from "@video-site/db/schema/tags";
import { video } from "@video-site/db/schema/video";
import { viewEvent } from "@video-site/db/schema/view-event";
import { env } from "@video-site/env/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { z } from "zod";

import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { assertHashAllowed } from "../lib/upload-guard";
import { detectThumbnailBuffer } from "../lib/file-validation";
import { activeAuthorWhere, visibleVideoWhere } from "../lib/moderation-filters";
import { cleanupQueue, thumbnailQueue, transcodeQueue } from "../lib/queue";
import { getRedisClient } from "../lib/redis";
import { storage } from "../lib/storage";
import { invalidateStreamableVideoMeta } from "../lib/streaming-meta";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { requireNotMuted } from "../middleware/require-active-user";
import type { AppVariables } from "../types";

function streamUrlFor(videoId: string, status: string): string | null {
  return status === "ready" ? `/api/stream/${videoId}/manifest.mpd` : null;
}

function thumbnailUrlFor(
  videoId: string,
  thumbnailPath: string | null,
  stillIndex?: number | null,
): string | null {
  if (!thumbnailPath) return null;
  const base = `/api/stream/${videoId}/thumbnail`;
  return stillIndex == null ? base : `${base}?v=${stillIndex}`;
}

function storyboardUrlFor(videoId: string, storyboardPath: string | null): string | null {
  if (!storyboardPath) return null;
  return `/api/stream/${videoId}/storyboard`;
}

function userAvatarUrlFor(userId: string, image: string | null): string | null {
  if (!image) return null;
  if (/^https?:\/\//.test(image)) return image;
  return `/api/profile/${userId}/image/avatar`;
}

function hashIpUa(c: {
  req: { raw: Request; header: (name: string) => string | undefined };
}): string {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const ua = c.req.header("user-agent") ?? "unknown";
  return new Bun.CryptoHasher("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
}

const GUEST_SESSION_COOKIE = "vs_gsid";
const GUEST_SESSION_MAX_AGE = 60 * 60 * 24 * 90;

function getOrSetGuestSessionId(c: Context): string {
  const existing = getCookie(c, GUEST_SESSION_COOKIE);
  if (existing) return existing;
  const sid = generateId();
  setCookie(c, GUEST_SESSION_COOKIE, sid, {
    path: "/",
    maxAge: GUEST_SESSION_MAX_AGE,
    sameSite: "Lax",
    httpOnly: true,
    secure: env.NODE_ENV === "production",
  });
  return sid;
}

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const visibilitySchema = z.enum(["public", "unlisted", "private"]);

const tagIdsSchema = z.array(z.string().min(1).max(80)).max(20);

const createVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(""),
  visibility: visibilitySchema.default("public"),
  tagIds: tagIdsSchema.optional(),
  filename: z.string().min(1),
  mimeType: z.string().refine((v) => v.startsWith("video/"), {
    message: "mimeType must start with 'video/'",
  }),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE, `File size must be <= ${MAX_FILE_SIZE} bytes`),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/, "fileHash must be a 64-char lowercase hex SHA-256"),
});

const updateVideoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  visibility: visibilitySchema.optional(),
  tagIds: tagIdsSchema.optional(),
});

async function resolveTagSlugs(tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await db
    .select({ id: tag.id, slug: tag.slug })
    .from(tag)
    .where(inArray(tag.id, tagIds));
  if (rows.length !== tagIds.length) {
    throw new ValidationError("One or more tagIds are invalid");
  }
  return rows.map((r) => r.slug);
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(24),
  sort: z.enum(["newest", "oldest", "popular"]).default("newest"),
  category: z.string().trim().min(1).max(80).optional(),
});

const myListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(24),
});

export const videoRoutes = new Hono<{ Variables: AppVariables }>();

videoRoutes.post(
  "/",
  ...requireNotMuted,
  rateLimit({ name: "video:create", limit: 10, windowSeconds: 3600 }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createVideoSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
    }

    const currentUser = c.get("user");
    const id = generateId();

    await assertHashAllowed(parsed.data.fileHash, { uploaderId: currentUser.id });

    const uniqueTagIds = parsed.data.tagIds ? [...new Set(parsed.data.tagIds)] : [];
    const slugs = await resolveTagSlugs(uniqueTagIds);

    await db.transaction(async (tx) => {
      await tx.insert(video).values({
        id,
        title: parsed.data.title,
        description: parsed.data.description,
        visibility: parsed.data.visibility,
        tags: slugs.length > 0 ? slugs : null,
        originalFilename: parsed.data.filename,
        mimeType: parsed.data.mimeType,
        fileSize: parsed.data.fileSize,
        fileHash: parsed.data.fileHash,
        userId: currentUser.id,
        status: "uploading",
      });
      if (uniqueTagIds.length > 0) {
        await tx.insert(videoTag).values(uniqueTagIds.map((tagId) => ({ videoId: id, tagId })));
      }
    });

    return c.json({ id, uploadUrl: "/api/uploads" }, 201);
  },
);

videoRoutes.get("/my", requireAuth, async (c) => {
  const parsed = myListQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }
  const { page, limit } = parsed.data;
  const currentUser = c.get("user");

  const rows = await db
    .select()
    .from(video)
    .where(eq(video.userId, currentUser.id))
    .orderBy(desc(video.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const items = rows.map((r) => ({
    ...r,
    thumbnailUrl: thumbnailUrlFor(r.id, r.thumbnailPath, r.thumbnailStillIndex),
    isRemoved: r.deletedAt != null,
  }));

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(video)
    .where(eq(video.userId, currentUser.id));
  const count = countResult[0]?.count ?? 0;

  return c.json({ items, page, limit, total: count });
});

videoRoutes.get("/", async (c) => {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }
  const { page, limit, sort, category: categorySlug } = parsed.data;

  const orderBy =
    sort === "oldest"
      ? asc(video.createdAt)
      : sort === "popular"
        ? desc(video.viewCount)
        : desc(video.createdAt);

  let categoryFilter: ReturnType<typeof sql> | undefined;
  if (categorySlug) {
    const [cat] = await db
      .select({ id: category.id, mode: category.mode })
      .from(category)
      .where(eq(category.slug, categorySlug))
      .limit(1);
    if (!cat) {
      return c.json({ items: [], page, limit, total: 0, totalPages: 0 });
    }
    const tagRows = await db
      .select({ id: tag.id })
      .from(categoryTag)
      .innerJoin(tag, eq(tag.id, categoryTag.tagId))
      .where(eq(categoryTag.categoryId, cat.id));
    if (tagRows.length === 0) {
      return c.json({ items: [], page, limit, total: 0, totalPages: 0 });
    }
    const tagIds = tagRows.map((r) => r.id);
    categoryFilter =
      cat.mode === "all"
        ? sql`(
            SELECT COUNT(DISTINCT ${videoTag.tagId})
            FROM ${videoTag}
            WHERE ${videoTag.videoId} = ${video.id}
              AND ${inArray(videoTag.tagId, tagIds)}
          ) = ${tagIds.length}`
        : sql`EXISTS (
            SELECT 1 FROM ${videoTag}
            WHERE ${videoTag.videoId} = ${video.id}
              AND ${inArray(videoTag.tagId, tagIds)}
          )`;
  }

  const baseConditions = [
    eq(video.status, "ready"),
    eq(video.visibility, "public"),
    visibleVideoWhere(),
    activeAuthorWhere(),
  ];
  const where = categoryFilter ? and(...baseConditions, categoryFilter) : and(...baseConditions);

  const rows = await db
    .select({
      id: video.id,
      title: video.title,
      thumbnailPath: video.thumbnailPath,
      thumbnailStillIndex: video.thumbnailStillIndex,
      duration: video.duration,
      viewCount: video.viewCount,
      createdAt: video.createdAt,
      userId: video.userId,
      userName: user.name,
      userImage: user.image,
      totalCount: sql<number>`count(*) over()::int`,
    })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(where)
    .orderBy(orderBy)
    .limit(limit)
    .offset((page - 1) * limit);

  const total = rows[0]?.totalCount ?? 0;
  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    thumbnailPath: r.thumbnailPath,
    thumbnailUrl: thumbnailUrlFor(r.id, r.thumbnailPath, r.thumbnailStillIndex),
    duration: r.duration,
    viewCount: r.viewCount,
    createdAt: r.createdAt,
    user: { id: r.userId, name: r.userName, image: userAvatarUrlFor(r.userId, r.userImage) },
  }));

  return c.json({
    items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

videoRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const currentUserId = session?.user.id;

  const [row] = await db
    .select({
      v: video,
      userName: user.name,
      userImage: user.image,
      userHandle: user.handle,
      authorBannedAt: user.bannedAt,
      authorSuspendedUntil: user.suspendedUntil,
    })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(eq(video.id, id))
    .limit(1);

  if (!row) {
    throw new NotFoundError("Video");
  }

  const isOwner = currentUserId === row.v.userId;
  if (row.v.visibility === "private" && !isOwner) {
    throw new NotFoundError("Video");
  }
  if (!isOwner) {
    if (row.v.deletedAt) throw new NotFoundError("Video");
    if (row.authorBannedAt) throw new NotFoundError("Video");
    if (row.authorSuspendedUntil && row.authorSuspendedUntil > new Date()) {
      throw new NotFoundError("Video");
    }
  }

  return c.json({
    ...row.v,
    streamUrl: streamUrlFor(row.v.id, row.v.status),
    thumbnailUrl: thumbnailUrlFor(row.v.id, row.v.thumbnailPath, row.v.thumbnailStillIndex),
    storyboardUrl: storyboardUrlFor(row.v.id, row.v.storyboardPath),
    storyboard: row.v.storyboardPath
      ? {
          interval: row.v.storyboardInterval,
          cols: row.v.storyboardCols,
          rows: row.v.storyboardRows,
          tileWidth: row.v.storyboardTileWidth,
          tileHeight: row.v.storyboardTileHeight,
        }
      : null,
    user: {
      id: row.v.userId,
      name: row.userName,
      image: userAvatarUrlFor(row.v.userId, row.userImage),
      handle: row.userHandle,
    },
  });
});

videoRoutes.post(
  "/:id/view",
  rateLimit({ name: "video:view", limit: 120, windowSeconds: 60 }),
  async (c) => {
    const videoId = c.req.param("id");

    const [row] = await db
      .select({
        visibility: video.visibility,
        status: video.status,
        userId: video.userId,
        deletedAt: video.deletedAt,
        authorBannedAt: user.bannedAt,
        authorSuspendedUntil: user.suspendedUntil,
      })
      .from(video)
      .innerJoin(user, eq(user.id, video.userId))
      .where(eq(video.id, videoId))
      .limit(1);

    if (!row || row.status !== "ready") {
      throw new NotFoundError("Video");
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (row.visibility === "private" && session?.user.id !== row.userId) {
      throw new NotFoundError("Video");
    }
    if (
      row.deletedAt ||
      row.authorBannedAt ||
      (row.authorSuspendedUntil && row.authorSuspendedUntil > new Date())
    ) {
      throw new NotFoundError("Video");
    }

    const guestSessionId = session ? null : getOrSetGuestSessionId(c);
    const viewerKey = session
      ? `view:${videoId}:user:${session.user.id}`
      : `view:${videoId}:anon:${guestSessionId ?? hashIpUa(c)}`;

    const redis = getRedisClient();
    const wasSet = await redis.set(viewerKey, "1", "EX", 86400, "NX");
    if (!wasSet) {
      return c.json({ counted: false });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(video)
        .set({ viewCount: sql`${video.viewCount} + 1` })
        .where(eq(video.id, videoId));
      await tx.insert(viewEvent).values({
        id: generateId(),
        videoId,
        userId: session?.user.id ?? null,
        sessionId: guestSessionId,
      });
    });

    return c.json({ counted: true });
  },
);

videoRoutes.patch("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateVideoSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const [existing] = await db
    .select({ userId: video.userId })
    .from(video)
    .where(eq(video.id, id))
    .limit(1);
  if (!existing) {
    throw new NotFoundError("Video");
  }
  const currentUser = c.get("user");
  if (existing.userId !== currentUser.id) {
    throw new ForbiddenError();
  }

  const uniqueTagIds = parsed.data.tagIds ? [...new Set(parsed.data.tagIds)] : undefined;
  const slugs = uniqueTagIds ? await resolveTagSlugs(uniqueTagIds) : undefined;

  const fields: Partial<typeof video.$inferInsert> = {};
  if (parsed.data.title !== undefined) fields.title = parsed.data.title;
  if (parsed.data.description !== undefined) fields.description = parsed.data.description;
  if (parsed.data.visibility !== undefined) fields.visibility = parsed.data.visibility;
  if (slugs !== undefined) fields.tags = slugs.length > 0 ? slugs : null;

  await db.transaction(async (tx) => {
    if (Object.keys(fields).length > 0) {
      await tx.update(video).set(fields).where(eq(video.id, id));
    }
    if (uniqueTagIds !== undefined) {
      await tx.delete(videoTag).where(eq(videoTag.videoId, id));
      if (uniqueTagIds.length > 0) {
        await tx.insert(videoTag).values(uniqueTagIds.map((tagId) => ({ videoId: id, tagId })));
      }
    }
  });

  await invalidateStreamableVideoMeta(id);
  return c.json({ ok: true });
});

videoRoutes.delete("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");

  const [existing] = await db
    .select({ userId: video.userId })
    .from(video)
    .where(eq(video.id, id))
    .limit(1);
  if (!existing) {
    throw new NotFoundError("Video");
  }
  const currentUser = c.get("user");
  if (existing.userId !== currentUser.id) {
    throw new ForbiddenError();
  }

  await db.delete(video).where(eq(video.id, id));
  await cleanupQueue.add("delete-video", { type: "delete-video", videoId: id });
  await invalidateStreamableVideoMeta(id);

  return c.json({ ok: true });
});

videoRoutes.get("/:id/status", requireAuth, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  const [row] = await db
    .select({
      userId: video.userId,
      status: video.status,
      processingError: video.processingError,
    })
    .from(video)
    .where(eq(video.id, id))
    .limit(1);

  if (!row) {
    throw new NotFoundError("Video");
  }
  if (row.userId !== currentUser.id) {
    throw new ForbiddenError();
  }

  let progress: unknown = null;
  if (row.status === "processing") {
    const job = await transcodeQueue.getJob(id);
    progress = job?.progress ?? null;
  }

  return c.json({
    status: row.status,
    progress,
    error: row.processingError,
  });
});

videoRoutes.post(
  "/:id/thumbnail",
  requireAuth,
  rateLimit({ name: "video:thumbnail", limit: 20, windowSeconds: 600 }),
  async (c) => {
    const id = c.req.param("id");
    const currentUser = c.get("user");

    const [existing] = await db
      .select({ userId: video.userId })
      .from(video)
      .where(eq(video.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundError("Video");
    }
    if (existing.userId !== currentUser.id) {
      throw new ForbiddenError();
    }

    const body = await c.req.parseBody();
    const file = body["thumbnail"];
    if (!(file instanceof File)) {
      throw new ValidationError("No thumbnail file provided");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new ValidationError("Thumbnail must be under 5MB");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await detectThumbnailBuffer(bytes);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : "Invalid image");
    }

    const tempPath = storage.resolve("temp", `thumb-${id}-${Date.now()}`);
    await Bun.write(tempPath, bytes);

    await thumbnailQueue.add("thumbnail", {
      videoId: id,
      thumbnailSourcePath: tempPath,
    });

    return c.json({ ok: true });
  },
);

const selectThumbnailSchema = z.object({
  index: z.number().int().min(0).max(99),
});

videoRoutes.post("/:id/thumbnail/select", requireAuth, async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = selectThumbnailSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }
  const { index } = parsed.data;

  const [existing] = await db
    .select({
      userId: video.userId,
      stillsCount: video.thumbnailStillsCount,
    })
    .from(video)
    .where(eq(video.id, id))
    .limit(1);
  if (!existing) {
    throw new NotFoundError("Video");
  }
  if (existing.userId !== currentUser.id) {
    throw new ForbiddenError();
  }
  if (existing.stillsCount <= 0) {
    throw new ValidationError("Thumbnail candidates not available yet");
  }
  if (index >= existing.stillsCount) {
    throw new ValidationError("Invalid thumbnail index");
  }

  const stillPath = storage.resolve("videos", id, "thumbnails", `still-${index}.jpg`);

  await db
    .update(video)
    .set({ thumbnailPath: stillPath, thumbnailStillIndex: index })
    .where(eq(video.id, id));

  return c.json({ ok: true });
});
