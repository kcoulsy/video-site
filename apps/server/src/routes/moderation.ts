import { db, generateId } from "@video-site/db";
import { session, user } from "@video-site/db/schema/auth";
import { comment } from "@video-site/db/schema/comment";
import { moderationAction, report } from "@video-site/db/schema/moderation";
import { video } from "@video-site/db/schema/video";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { AppError, NotFoundError, ValidationError } from "../lib/errors";
import { logModerationAction } from "../lib/moderation-log";
import { cleanupQueue } from "../lib/queue";
import { getRedisClient } from "../lib/redis";
import { requireActiveUser } from "../middleware/require-active-user";
import { requireAdmin } from "../middleware/require-admin";
import { requireModerator } from "../middleware/require-moderator";
import type { AppVariables } from "../types";

export const moderationRoutes = new Hono<{ Variables: AppVariables }>();

const reasonSchema = z.string().trim().min(1).max(1000).optional();
const requiredReasonSchema = z.string().trim().min(1).max(1000);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

// ---------- User-facing reports ----------

const REPORT_RATE_PER_MIN = 5;
const REPORT_RATE_PER_DAY = 30;

const createReportSchema = z.object({
  targetType: z.enum(["video", "comment"]),
  targetId: z.string().min(1).max(200),
  reasonCategory: z.enum(["spam", "harassment", "sexual", "violence", "illegal", "other"]),
  reason: z.string().trim().max(500).optional(),
});

async function checkReportRateLimit(userId: string) {
  const redis = getRedisClient();
  const minuteKey = `report-rate-min:${userId}`;
  const dayKey = `report-rate-day:${userId}`;
  const result = await redis
    .multi()
    .incr(minuteKey)
    .expire(minuteKey, 60)
    .incr(dayKey)
    .expire(dayKey, 86400)
    .exec();
  const minCount = result?.[0]?.[1] as number | undefined;
  const dayCount = result?.[2]?.[1] as number | undefined;
  if ((minCount ?? 0) > REPORT_RATE_PER_MIN || (dayCount ?? 0) > REPORT_RATE_PER_DAY) {
    throw new AppError(429, "Report rate limit exceeded", "RATE_LIMITED");
  }
}

moderationRoutes.post("/reports", ...requireActiveUser, async (c) => {
  const currentUser = c.get("user");
  const body = await c.req.json().catch(() => null);
  const parsed = createReportSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  // Validate target exists
  const { targetType, targetId } = parsed.data;
  if (targetType === "video") {
    const [v] = await db.select({ id: video.id }).from(video).where(eq(video.id, targetId)).limit(1);
    if (!v) throw new NotFoundError("Video");
  } else {
    const [cm] = await db
      .select({ id: comment.id })
      .from(comment)
      .where(eq(comment.id, targetId))
      .limit(1);
    if (!cm) throw new NotFoundError("Comment");
  }

  // Dedupe by partial unique index
  const [existing] = await db
    .select({ id: report.id })
    .from(report)
    .where(
      and(
        eq(report.reporterId, currentUser.id),
        eq(report.targetType, targetType),
        eq(report.targetId, targetId),
        eq(report.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) {
    return c.json({ id: existing.id, deduped: true });
  }

  await checkReportRateLimit(currentUser.id);

  const id = generateId();
  await db.insert(report).values({
    id,
    reporterId: currentUser.id,
    targetType,
    targetId,
    reasonCategory: parsed.data.reasonCategory,
    reason: parsed.data.reason ?? null,
    status: "pending",
  });

  return c.json({ id }, 201);
});

// ---------- Mod-only routes ----------

const modOnly = new Hono<{ Variables: AppVariables }>();
modOnly.use("*", ...requireModerator);

// User restrictions

const banSchema = z.object({ reason: requiredReasonSchema });
const suspendSchema = z.object({
  until: z.string().datetime(),
  reason: requiredReasonSchema,
});
const muteSchema = z.object({ reason: requiredReasonSchema });

async function loadUserOrFail(id: string) {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (!u) throw new NotFoundError("User");
}

modOnly.post("/users/:id/ban", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  if (id === actor.id) throw new ValidationError("Cannot ban yourself");
  await loadUserOrFail(id);

  const body = await c.req.json().catch(() => null);
  const parsed = banSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid body");

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ bannedAt: new Date(), banReason: parsed.data.reason, bannedBy: actor.id })
      .where(eq(user.id, id));
    await tx.delete(session).where(eq(session.userId, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "ban",
      targetType: "user",
      targetId: id,
      reason: parsed.data.reason,
    });
  });
  return c.json({ ok: true });
});

modOnly.post("/users/:id/unban", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  await loadUserOrFail(id);
  const body = await c.req.json().catch(() => ({}));
  const reason = reasonSchema.parse((body as { reason?: string })?.reason);

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ bannedAt: null, banReason: null, bannedBy: null })
      .where(eq(user.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "unban",
      targetType: "user",
      targetId: id,
      reason: reason ?? null,
    });
  });
  return c.json({ ok: true });
});

modOnly.post("/users/:id/suspend", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  if (id === actor.id) throw new ValidationError("Cannot suspend yourself");
  await loadUserOrFail(id);

  const body = await c.req.json().catch(() => null);
  const parsed = suspendSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid body");

  const until = new Date(parsed.data.until);
  if (until <= new Date()) {
    throw new ValidationError("until must be in the future");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        suspendedUntil: until,
        suspendReason: parsed.data.reason,
        suspendedBy: actor.id,
      })
      .where(eq(user.id, id));
    await tx.delete(session).where(eq(session.userId, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "suspend",
      targetType: "user",
      targetId: id,
      reason: parsed.data.reason,
      metadata: { until: until.toISOString() },
    });
  });
  return c.json({ ok: true });
});

modOnly.post("/users/:id/unsuspend", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  await loadUserOrFail(id);

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ suspendedUntil: null, suspendReason: null, suspendedBy: null })
      .where(eq(user.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "unsuspend",
      targetType: "user",
      targetId: id,
    });
  });
  return c.json({ ok: true });
});

modOnly.post("/users/:id/mute", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  if (id === actor.id) throw new ValidationError("Cannot mute yourself");
  await loadUserOrFail(id);

  const body = await c.req.json().catch(() => null);
  const parsed = muteSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid body");

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ mutedAt: new Date(), muteReason: parsed.data.reason, mutedBy: actor.id })
      .where(eq(user.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "mute",
      targetType: "user",
      targetId: id,
      reason: parsed.data.reason,
    });
  });
  return c.json({ ok: true });
});

modOnly.post("/users/:id/unmute", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  await loadUserOrFail(id);

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ mutedAt: null, muteReason: null, mutedBy: null })
      .where(eq(user.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "unmute",
      targetType: "user",
      targetId: id,
    });
  });
  return c.json({ ok: true });
});

// Video soft-remove / restore

modOnly.post("/videos/:id/remove", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ reason: requiredReasonSchema }).safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid body");

  const [existing] = await db.select({ id: video.id }).from(video).where(eq(video.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Video");

  await db.transaction(async (tx) => {
    await tx
      .update(video)
      .set({ deletedAt: new Date(), removedBy: actor.id, removalReason: parsed.data.reason })
      .where(eq(video.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "remove_video",
      targetType: "video",
      targetId: id,
      reason: parsed.data.reason,
    });
  });
  return c.json({ ok: true });
});

modOnly.post("/videos/:id/restore", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  const [existing] = await db.select({ id: video.id }).from(video).where(eq(video.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Video");

  await db.transaction(async (tx) => {
    await tx
      .update(video)
      .set({ deletedAt: null, removedBy: null, removalReason: null })
      .where(eq(video.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "restore_video",
      targetType: "video",
      targetId: id,
    });
  });
  return c.json({ ok: true });
});

// Comment soft-remove / restore

modOnly.post("/comments/:id/remove", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ reason: requiredReasonSchema }).safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid body");

  const [existing] = await db
    .select({ id: comment.id })
    .from(comment)
    .where(eq(comment.id, id))
    .limit(1);
  if (!existing) throw new NotFoundError("Comment");

  await db.transaction(async (tx) => {
    await tx
      .update(comment)
      .set({ deletedAt: new Date(), removedBy: actor.id, removalReason: parsed.data.reason })
      .where(eq(comment.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "remove_comment",
      targetType: "comment",
      targetId: id,
      reason: parsed.data.reason,
    });
  });
  return c.json({ ok: true });
});

modOnly.post("/comments/:id/restore", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  const [existing] = await db
    .select({ id: comment.id })
    .from(comment)
    .where(eq(comment.id, id))
    .limit(1);
  if (!existing) throw new NotFoundError("Comment");

  await db.transaction(async (tx) => {
    await tx
      .update(comment)
      .set({ deletedAt: null, removedBy: null, removalReason: null })
      .where(eq(comment.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "restore_comment",
      targetType: "comment",
      targetId: id,
    });
  });
  return c.json({ ok: true });
});

// Reports queue

const reportsListQuerySchema = listQuerySchema.extend({
  status: z.enum(["pending", "resolved", "dismissed"]).optional(),
});

modOnly.get("/reports", async (c) => {
  const parsed = reportsListQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) throw new ValidationError("Invalid query");
  const { page, limit, status } = parsed.data;

  const where = status ? eq(report.status, status) : undefined;

  const items = await db
    .select({
      id: report.id,
      reporterId: report.reporterId,
      targetType: report.targetType,
      targetId: report.targetId,
      reasonCategory: report.reasonCategory,
      reason: report.reason,
      status: report.status,
      resolvedBy: report.resolvedBy,
      resolvedAt: report.resolvedAt,
      resolutionNote: report.resolutionNote,
      createdAt: report.createdAt,
      reporterName: user.name,
      reporterEmail: user.email,
    })
    .from(report)
    .leftJoin(user, eq(user.id, report.reporterId))
    .where(where)
    .orderBy(desc(report.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(report)
    .where(where);

  return c.json({ items, page, limit, total: total?.count ?? 0 });
});

modOnly.post("/reports/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const note = reasonSchema.parse((body as { note?: string })?.note);

  const [existing] = await db.select({ id: report.id }).from(report).where(eq(report.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Report");

  await db.transaction(async (tx) => {
    await tx
      .update(report)
      .set({
        status: "resolved",
        resolvedBy: actor.id,
        resolvedAt: new Date(),
        resolutionNote: note ?? null,
      })
      .where(eq(report.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "resolve_report",
      targetType: "report",
      targetId: id,
      reason: note ?? null,
    });
  });
  return c.json({ ok: true });
});

modOnly.post("/reports/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const note = reasonSchema.parse((body as { note?: string })?.note);

  const [existing] = await db.select({ id: report.id }).from(report).where(eq(report.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Report");

  await db.transaction(async (tx) => {
    await tx
      .update(report)
      .set({
        status: "dismissed",
        resolvedBy: actor.id,
        resolvedAt: new Date(),
        resolutionNote: note ?? null,
      })
      .where(eq(report.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "dismiss_report",
      targetType: "report",
      targetId: id,
      reason: note ?? null,
    });
  });
  return c.json({ ok: true });
});

// Audit log

const auditQuerySchema = listQuerySchema.extend({
  actorId: z.string().optional(),
  targetType: z.enum(["user", "video", "comment", "report"]).optional(),
  action: z.string().optional(),
});

modOnly.get("/actions", async (c) => {
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) throw new ValidationError("Invalid query");
  const { page, limit, actorId, targetType, action } = parsed.data;

  const conditions = [
    actorId ? eq(moderationAction.actorId, actorId) : undefined,
    targetType ? eq(moderationAction.targetType, targetType) : undefined,
    action ? eq(moderationAction.action, action as never) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conditions.length ? and(...conditions) : undefined;

  const items = await db
    .select({
      id: moderationAction.id,
      actorId: moderationAction.actorId,
      action: moderationAction.action,
      targetType: moderationAction.targetType,
      targetId: moderationAction.targetId,
      reason: moderationAction.reason,
      metadata: moderationAction.metadata,
      createdAt: moderationAction.createdAt,
      actorName: user.name,
      actorEmail: user.email,
    })
    .from(moderationAction)
    .leftJoin(user, eq(user.id, moderationAction.actorId))
    .where(where)
    .orderBy(desc(moderationAction.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(moderationAction)
    .where(where);

  return c.json({ items, page, limit, total: total?.count ?? 0 });
});

// Hard delete (admin only)

const adminOnly = new Hono<{ Variables: AppVariables }>();
adminOnly.use("*", ...requireAdmin);

adminOnly.delete("/videos/:id", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");
  const [existing] = await db.select({ id: video.id }).from(video).where(eq(video.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Video");

  await db.transaction(async (tx) => {
    await tx.delete(video).where(eq(video.id, id));
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "hard_delete_video",
      targetType: "video",
      targetId: id,
    });
  });
  await cleanupQueue.add("delete-video", { type: "delete-video", videoId: id });
  return c.json({ ok: true });
});

adminOnly.delete("/comments/:id", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("user");

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
    await logModerationAction(tx, {
      actorId: actor.id,
      action: "hard_delete_comment",
      targetType: "comment",
      targetId: id,
    });
  });
  return c.json({ ok: true });
});

moderationRoutes.route("/", modOnly);
moderationRoutes.route("/admin", adminOnly);
