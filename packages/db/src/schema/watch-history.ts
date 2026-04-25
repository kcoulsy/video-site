import { index, integer, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { video } from "./video";

export const watchHistory = pgTable(
  "watch_history",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),

    watchedSeconds: integer("watched_seconds").default(0).notNull(),
    totalDuration: integer("total_duration").notNull(),
    progressPercent: real("progress_percent").default(0).notNull(),

    completedAt: timestamp("completed_at"),

    lastWatchedAt: timestamp("last_watched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.videoId] }),
    index("watch_history_user_id_last_watched_at_idx").on(table.userId, table.lastWatchedAt),
  ],
);
