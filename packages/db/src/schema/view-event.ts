import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { video } from "./video";

export const viewEvent = pgTable(
  "view_event",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    viewedAt: timestamp("viewed_at").defaultNow().notNull(),
  },
  (table) => [
    index("view_event_video_id_viewed_at_idx").on(table.videoId, table.viewedAt),
    index("view_event_viewed_at_idx").on(table.viewedAt),
  ],
);
