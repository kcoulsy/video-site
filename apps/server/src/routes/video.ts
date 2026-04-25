import { auth } from "@video-site/auth";
import { db, generateId } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { video } from "@video-site/db/schema/video";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { cleanupQueue, thumbnailQueue, transcodeQueue } from "../lib/queue";
import { storage } from "../lib/storage";
import { requireAuth } from "../middleware/auth";
import type { AppVariables } from "../types";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const visibilitySchema = z.enum(["public", "unlisted", "private"]);

const createVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(""),
  visibility: visibilitySchema.default("public"),
  tags: z.array(z.string().max(50)).max(20).optional(),
  filename: z.string().min(1),
  mimeType: z.string().refine((v) => v.startsWith("video/"), {
    message: "mimeType must start with 'video/'",
  }),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE, `File size must be <= ${MAX_FILE_SIZE} bytes`),
});

const updateVideoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  visibility: visibilitySchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(24),
  sort: z.enum(["newest", "oldest", "popular"]).default("newest"),
});

const myListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(24),
});

export const videoRoutes = new Hono<{ Variables: AppVariables }>();

videoRoutes.post("/", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createVideoSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const currentUser = c.get("user");
  const id = generateId();

  await db.insert(video).values({
    id,
    title: parsed.data.title,
    description: parsed.data.description,
    visibility: parsed.data.visibility,
    tags: parsed.data.tags,
    originalFilename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    fileSize: parsed.data.fileSize,
    userId: currentUser.id,
    status: "uploading",
  });

  return c.json({ id, uploadUrl: "/api/uploads" }, 201);
});

videoRoutes.get("/my", requireAuth, async (c) => {
  const parsed = myListQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }
  const { page, limit } = parsed.data;
  const currentUser = c.get("user");

  const items = await db
    .select()
    .from(video)
    .where(eq(video.userId, currentUser.id))
    .orderBy(desc(video.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(video)
    .where(eq(video.userId, currentUser.id));
  const count = countResult[0]?.count ?? 0;

  return c.json({ items, page, limit, total: count });
});

videoRoutes.get("/", async (c) => {
  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    throw new ValidationError("Invalid query");
  }
  const { page, limit, sort } = parsed.data;

  const orderBy =
    sort === "oldest"
      ? video.createdAt
      : sort === "popular"
        ? desc(video.viewCount)
        : desc(video.createdAt);

  const where = and(
    eq(video.status, "ready"),
    eq(video.visibility, "public"),
  );

  const rows = await db
    .select({
      id: video.id,
      title: video.title,
      thumbnailPath: video.thumbnailPath,
      duration: video.duration,
      viewCount: video.viewCount,
      createdAt: video.createdAt,
      userId: video.userId,
      userName: user.name,
      userImage: user.image,
    })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(where)
    .orderBy(orderBy)
    .limit(limit)
    .offset((page - 1) * limit);

  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    thumbnailPath: r.thumbnailPath,
    duration: r.duration,
    viewCount: r.viewCount,
    createdAt: r.createdAt,
    user: { id: r.userId, name: r.userName, image: r.userImage },
  }));

  return c.json({ items, page, limit });
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

  return c.json({
    ...row.v,
    user: { id: row.v.userId, name: row.userName, image: row.userImage },
  });
});

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

  await db.update(video).set(parsed.data).where(eq(video.id, id));

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

videoRoutes.post("/:id/thumbnail", requireAuth, async (c) => {
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
  if (!file.type.startsWith("image/")) {
    throw new ValidationError("File must be an image");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new ValidationError("Thumbnail must be under 5MB");
  }

  const tempPath = storage.resolve("temp", `thumb-${id}-${Date.now()}`);
  await Bun.write(tempPath, file);

  await thumbnailQueue.add("thumbnail", {
    videoId: id,
    thumbnailSourcePath: tempPath,
  });

  return c.json({ ok: true });
});
