import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { video } from "./video";

export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    content: text("content").notNull(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),

    parentId: text("parent_id").references((): any => comment.id, {
      onDelete: "cascade",
    }),
    rootId: text("root_id").references((): any => comment.id, {
      onDelete: "cascade",
    }),

    depth: integer("depth").default(0).notNull(),

    replyCount: integer("reply_count").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),

    pinnedAt: timestamp("pinned_at"),
    creatorHeartedAt: timestamp("creator_hearted_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
    removedBy: text("removed_by"),
    removalReason: text("removal_reason"),

    reviewedAt: timestamp("reviewed_at"),
    reviewedBy: text("reviewed_by"),
  },
  (table) => [
    index("comment_video_id_idx").on(table.videoId),
    index("comment_parent_id_idx").on(table.parentId),
    index("comment_root_id_idx").on(table.rootId),
    index("comment_user_id_idx").on(table.userId),
    index("comment_video_id_created_at_idx").on(table.videoId, table.createdAt),
    index("comment_video_pinned_idx").on(table.videoId, table.pinnedAt),
    index("comment_reviewed_at_idx").on(table.reviewedAt),
  ],
);
