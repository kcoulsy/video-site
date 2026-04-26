import { db, generateId } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { comment } from "@video-site/db/schema/comment";
import { category, categoryTag, tag, videoTag } from "@video-site/db/schema/tags";
import { video } from "@video-site/db/schema/video";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { cleanupQueue } from "../lib/queue";
import { requireAdmin } from "../middleware/require-admin";
import type { AppVariables } from "../types";

export const adminRoutes = new Hono<{ Variables: AppVariables }>();

adminRoutes.use("*", ...requireAdmin);

const visibilitySchema = z.enum(["public", "unlisted", "private"]);
const statusSchema = z.enum(["uploading", "uploaded", "processing", "ready", "failed"]);
const roleSchema = z.enum(["user", "admin"]);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  q: z.string().trim().max(200).optional(),
});

// ---------- Stats ----------

adminRoutes.get("/stats", async (c) => {
  const sevenDaysAgo = sql`NOW() - INTERVAL '7 days'`;

  const [users] = await db.select({ count: sql<number>`count(*)::int` }).from(user);
  const [videos] = await db.select({ count: sql<number>`count(*)::int` }).from(video);
  const [comments] = await db.select({ count: sql<number>`count(*)::int` }).from(comment);

  const [recentSignups] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(user)
    .where(sql`${user.createdAt} > ${sevenDaysAgo}`);

  const [recentUploads] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(video)
    .where(sql`${video.createdAt} > ${sevenDaysAgo}`);

  const videosByStatus = await db
    .select({ status: video.status, count: sql<number>`count(*)::int` })
    .from(video)
    .groupBy(video.status);

  return c.json({
    users: users?.count ?? 0,
    videos: videos?.count ?? 0,
    comments: comments?.count ?? 0,
    recentSignups: recentSignups?.count ?? 0,
    recentUploads: recentUploads?.count ?? 0,
    videosByStatus: videosByStatus.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {}),
  });
});

// ---------- Users ----------

adminRoutes.get("/users", async (c) => {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) throw new ValidationError("Invalid query");
  const { page, limit, q } = parsed.data;

  const where = q ? or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`)) : undefined;

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      image: user.image,
      createdAt: user.createdAt,
      videoCount: sql<number>`(SELECT count(*)::int FROM ${video} WHERE ${video.userId} = ${user.id})`,
      commentCount: sql<number>`(SELECT count(*)::int FROM ${comment} WHERE ${comment.userId} = ${user.id})`,
    })
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(user).where(where);

  return c.json({ items: rows, page, limit, total: total?.count ?? 0 });
});

const updateUserSchema = z.object({ role: roleSchema });

adminRoutes.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  if (id === currentUser.id) {
    throw new ForbiddenError("Cannot modify your own role");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (!existing) throw new NotFoundError("User");

  await db.update(user).set({ role: parsed.data.role }).where(eq(user.id, id));
  return c.json({ ok: true });
});

adminRoutes.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  if (id === currentUser.id) {
    throw new ForbiddenError("Cannot delete your own account");
  }

  const userVideos = await db
    .select({ id: video.id })
    .from(video)
    .where(eq(video.userId, id));

  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (!existing) throw new NotFoundError("User");

  await db.delete(user).where(eq(user.id, id));

  for (const v of userVideos) {
    await cleanupQueue.add("delete-video", { type: "delete-video", videoId: v.id });
  }

  return c.json({ ok: true });
});

// ---------- Videos ----------

const adminVideoListQuerySchema = listQuerySchema.extend({
  status: statusSchema.optional(),
  visibility: visibilitySchema.optional(),
});

adminRoutes.get("/videos", async (c) => {
  const parsed = adminVideoListQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) throw new ValidationError("Invalid query");
  const { page, limit, q, status, visibility } = parsed.data;

  const conditions = [
    q ? or(ilike(video.title, `%${q}%`), ilike(video.description, `%${q}%`)) : undefined,
    status ? eq(video.status, status) : undefined,
    visibility ? eq(video.visibility, visibility) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: video.id,
      title: video.title,
      status: video.status,
      visibility: video.visibility,
      duration: video.duration,
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      commentCount: video.commentCount,
      thumbnailPath: video.thumbnailPath,
      createdAt: video.createdAt,
      ownerId: user.id,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(where)
    .orderBy(desc(video.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(video).where(where);

  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    visibility: r.visibility,
    duration: r.duration,
    viewCount: r.viewCount,
    likeCount: r.likeCount,
    commentCount: r.commentCount,
    thumbnailUrl: r.thumbnailPath ? `/api/stream/${r.id}/thumbnail` : null,
    createdAt: r.createdAt,
    owner: { id: r.ownerId, name: r.ownerName, email: r.ownerEmail },
  }));

  return c.json({ items, page, limit, total: total?.count ?? 0 });
});

const updateVideoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  visibility: visibilitySchema.optional(),
  tagIds: z.array(z.string().min(1).max(80)).max(20).optional(),
});

adminRoutes.patch("/videos/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateVideoSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const [existing] = await db.select({ id: video.id }).from(video).where(eq(video.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Video");

  const uniqueTagIds = parsed.data.tagIds ? [...new Set(parsed.data.tagIds)] : undefined;
  let slugs: string[] | undefined;
  if (uniqueTagIds && uniqueTagIds.length > 0) {
    const rows = await db
      .select({ id: tag.id, slug: tag.slug })
      .from(tag)
      .where(inArray(tag.id, uniqueTagIds));
    if (rows.length !== uniqueTagIds.length) {
      throw new ValidationError("One or more tagIds are invalid");
    }
    slugs = rows.map((r) => r.slug);
  } else if (uniqueTagIds) {
    slugs = [];
  }

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
        await tx
          .insert(videoTag)
          .values(uniqueTagIds.map((tagId) => ({ videoId: id, tagId })));
      }
    }
  });

  return c.json({ ok: true });
});

adminRoutes.delete("/videos/:id", async (c) => {
  const id = c.req.param("id");

  const [existing] = await db.select({ id: video.id }).from(video).where(eq(video.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Video");

  await db.delete(video).where(eq(video.id, id));
  await cleanupQueue.add("delete-video", { type: "delete-video", videoId: id });

  return c.json({ ok: true });
});

// ---------- Comments ----------

const commentListQuerySchema = listQuerySchema.extend({
  videoId: z.string().min(1).optional(),
});

adminRoutes.get("/comments", async (c) => {
  const parsed = commentListQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) throw new ValidationError("Invalid query");
  const { page, limit, q, videoId } = parsed.data;

  const conditions = [
    q ? ilike(comment.content, `%${q}%`) : undefined,
    videoId ? eq(comment.videoId, videoId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      deletedAt: comment.deletedAt,
      videoId: comment.videoId,
      videoTitle: video.title,
      authorId: user.id,
      authorName: user.name,
      authorEmail: user.email,
    })
    .from(comment)
    .innerJoin(user, eq(user.id, comment.userId))
    .innerJoin(video, eq(video.id, comment.videoId))
    .where(where)
    .orderBy(desc(comment.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comment)
    .where(where);

  return c.json({ items: rows, page, limit, total: total?.count ?? 0 });
});

// ---------- Tags ----------

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, digits, hyphens");

const createTagSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
});

const updateTagSchema = createTagSchema.partial();

adminRoutes.get("/tags", async (c) => {
  const items = await db
    .select({
      id: tag.id,
      slug: tag.slug,
      name: tag.name,
      createdAt: tag.createdAt,
      videoCount: sql<number>`(SELECT count(*)::int FROM ${videoTag} WHERE ${videoTag.tagId} = ${tag.id})`,
    })
    .from(tag)
    .orderBy(asc(tag.name));
  return c.json({ items });
});

adminRoutes.post("/tags", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createTagSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }
  const [existing] = await db
    .select({ id: tag.id })
    .from(tag)
    .where(eq(tag.slug, parsed.data.slug))
    .limit(1);
  if (existing) throw new ValidationError("Slug already in use");

  const id = generateId();
  await db.insert(tag).values({ id, slug: parsed.data.slug, name: parsed.data.name });
  return c.json({ id }, 201);
});

adminRoutes.patch("/tags/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateTagSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }
  const [existing] = await db.select({ slug: tag.slug }).from(tag).where(eq(tag.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Tag");

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const [conflict] = await db
      .select({ id: tag.id })
      .from(tag)
      .where(eq(tag.slug, parsed.data.slug))
      .limit(1);
    if (conflict) throw new ValidationError("Slug already in use");
  }

  await db.transaction(async (tx) => {
    await tx.update(tag).set(parsed.data).where(eq(tag.id, id));
    if (parsed.data.slug && parsed.data.slug !== existing.slug) {
      // Re-sync videos.tags array for any video carrying the old slug.
      await tx.execute(
        sql`UPDATE ${video}
            SET tags = array_replace(tags, ${existing.slug}, ${parsed.data.slug})
            WHERE ${existing.slug} = ANY(tags)`,
      );
    }
  });
  return c.json({ ok: true });
});

adminRoutes.delete("/tags/:id", async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select({ slug: tag.slug }).from(tag).where(eq(tag.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Tag");

  await db.transaction(async (tx) => {
    await tx.delete(tag).where(eq(tag.id, id));
    await tx.execute(
      sql`UPDATE ${video} SET tags = array_remove(tags, ${existing.slug}) WHERE ${existing.slug} = ANY(tags)`,
    );
  });
  return c.json({ ok: true });
});

// ---------- Categories ----------

const categoryModeSchema = z.enum(["any", "all"]);

const createCategorySchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  mode: categoryModeSchema.default("any"),
  tagIds: z.array(z.string()).default([]),
  sortOrder: z.number().int().default(0),
});

const updateCategorySchema = createCategorySchema.partial();

adminRoutes.get("/categories", async (c) => {
  const cats = await db
    .select()
    .from(category)
    .orderBy(asc(category.sortOrder), asc(category.name));

  if (cats.length === 0) return c.json({ items: [] });

  const links = await db
    .select({ categoryId: categoryTag.categoryId, tagId: categoryTag.tagId })
    .from(categoryTag);

  const tagsByCategory = new Map<string, string[]>();
  for (const link of links) {
    const list = tagsByCategory.get(link.categoryId) ?? [];
    list.push(link.tagId);
    tagsByCategory.set(link.categoryId, list);
  }

  const items = cats.map((cat) => ({ ...cat, tagIds: tagsByCategory.get(cat.id) ?? [] }));
  return c.json({ items });
});

async function validateTagIds(tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return;
  const found = await db
    .select({ id: tag.id })
    .from(tag)
    .where(inArray(tag.id, tagIds));
  if (found.length !== tagIds.length) {
    throw new ValidationError("One or more tagIds are invalid");
  }
}

adminRoutes.post("/categories", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const [existing] = await db
    .select({ id: category.id })
    .from(category)
    .where(eq(category.slug, parsed.data.slug))
    .limit(1);
  if (existing) throw new ValidationError("Slug already in use");

  const uniqueTagIds = [...new Set(parsed.data.tagIds)];
  await validateTagIds(uniqueTagIds);

  const id = generateId();
  await db.transaction(async (tx) => {
    await tx.insert(category).values({
      id,
      slug: parsed.data.slug,
      name: parsed.data.name,
      mode: parsed.data.mode,
      sortOrder: parsed.data.sortOrder,
    });
    if (uniqueTagIds.length > 0) {
      await tx
        .insert(categoryTag)
        .values(uniqueTagIds.map((tagId) => ({ categoryId: id, tagId })));
    }
  });

  return c.json({ id }, 201);
});

adminRoutes.patch("/categories/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  const [existing] = await db
    .select({ slug: category.slug })
    .from(category)
    .where(eq(category.id, id))
    .limit(1);
  if (!existing) throw new NotFoundError("Category");

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const [conflict] = await db
      .select({ id: category.id })
      .from(category)
      .where(eq(category.slug, parsed.data.slug))
      .limit(1);
    if (conflict) throw new ValidationError("Slug already in use");
  }

  const uniqueTagIds = parsed.data.tagIds ? [...new Set(parsed.data.tagIds)] : undefined;
  if (uniqueTagIds) await validateTagIds(uniqueTagIds);

  const fields: Partial<typeof category.$inferInsert> = {};
  if (parsed.data.slug !== undefined) fields.slug = parsed.data.slug;
  if (parsed.data.name !== undefined) fields.name = parsed.data.name;
  if (parsed.data.mode !== undefined) fields.mode = parsed.data.mode;
  if (parsed.data.sortOrder !== undefined) fields.sortOrder = parsed.data.sortOrder;

  await db.transaction(async (tx) => {
    if (Object.keys(fields).length > 0) {
      await tx.update(category).set(fields).where(eq(category.id, id));
    }
    if (uniqueTagIds) {
      await tx.delete(categoryTag).where(eq(categoryTag.categoryId, id));
      if (uniqueTagIds.length > 0) {
        await tx
          .insert(categoryTag)
          .values(uniqueTagIds.map((tagId) => ({ categoryId: id, tagId })));
      }
    }
  });

  return c.json({ ok: true });
});

adminRoutes.delete("/categories/:id", async (c) => {
  const id = c.req.param("id");
  const [existing] = await db
    .select({ id: category.id })
    .from(category)
    .where(eq(category.id, id))
    .limit(1);
  if (!existing) throw new NotFoundError("Category");
  await db.delete(category).where(eq(category.id, id));
  return c.json({ ok: true });
});

adminRoutes.delete("/comments/:id", async (c) => {
  const id = c.req.param("id");

  const [existing] = await db
    .select({ videoId: comment.videoId, parentId: comment.parentId })
    .from(comment)
    .where(eq(comment.id, id))
    .limit(1);
  if (!existing) throw new NotFoundError("Comment");

  await db.transaction(async (tx) => {
    await tx.delete(comment).where(eq(comment.id, id));
    await tx
      .update(video)
      .set({ commentCount: sql`GREATEST(${video.commentCount} - 1, 0)` })
      .where(eq(video.id, existing.videoId));
    if (existing.parentId) {
      await tx
        .update(comment)
        .set({ replyCount: sql`GREATEST(${comment.replyCount} - 1, 0)` })
        .where(eq(comment.id, existing.parentId));
    }
  });

  return c.json({ ok: true });
});
