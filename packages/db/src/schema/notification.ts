import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { comment } from "./comment";
import { video } from "./video";

export const notificationKindEnum = pgEnum("notification_kind", [
  "new_upload",
  "comment_reply",
  "video_like",
  "comment_like",
  "mention",
]);

export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id").references(() => video.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => comment.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notification_recipient_created_idx").on(table.recipientId, table.createdAt),
    index("notification_recipient_unread_idx").on(table.recipientId, table.readAt),
  ],
);
