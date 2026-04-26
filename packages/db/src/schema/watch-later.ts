import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { video } from "./video";

export const watchLater = pgTable(
  "watch_later",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.videoId] }),
    index("watch_later_user_id_added_at_idx").on(table.userId, table.addedAt),
  ],
);
