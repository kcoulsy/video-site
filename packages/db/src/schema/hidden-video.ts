import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { video } from "./video";

export const hiddenVideo = pgTable(
  "hidden_video",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    hiddenAt: timestamp("hidden_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.videoId] }),
    index("hidden_video_user_id_hidden_at_idx").on(table.userId, table.hiddenAt),
  ],
);
