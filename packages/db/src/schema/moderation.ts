import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const moderationActionEnum = pgEnum("moderation_action_kind", [
  "ban",
  "unban",
  "suspend",
  "unsuspend",
  "mute",
  "unmute",
  "remove_video",
  "restore_video",
  "hard_delete_video",
  "remove_comment",
  "restore_comment",
  "hard_delete_comment",
  "role_change",
  "delete_user",
  "resolve_report",
  "dismiss_report",
  "approve_video",
  "approve_comment",
]);

export const moderationTargetEnum = pgEnum("moderation_target_kind", [
  "user",
  "video",
  "comment",
  "report",
]);

export const moderationAction = pgTable(
  "moderation_action",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: moderationActionEnum("action").notNull(),
    targetType: moderationTargetEnum("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("moderation_action_created_at_idx").on(t.createdAt),
    index("moderation_action_target_idx").on(t.targetType, t.targetId),
    index("moderation_action_actor_idx").on(t.actorId),
  ],
);

export const reportTargetEnum = pgEnum("report_target", ["video", "comment"]);

export const reportReasonEnum = pgEnum("report_reason", [
  "spam",
  "harassment",
  "sexual",
  "violence",
  "illegal",
  "other",
]);

export const reportStatusEnum = pgEnum("report_status", ["pending", "resolved", "dismissed"]);

export const report = pgTable(
  "report",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    targetType: reportTargetEnum("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reasonCategory: reportReasonEnum("reason_category").notNull(),
    reason: text("reason"),
    status: reportStatusEnum("status").notNull().default("pending"),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("report_status_created_at_idx").on(t.status, t.createdAt),
    index("report_target_idx").on(t.targetType, t.targetId),
    index("report_reporter_idx").on(t.reporterId),
    uniqueIndex("report_unique_pending_idx")
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`status = 'pending'`),
  ],
);
