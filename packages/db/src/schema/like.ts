import { index, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { video } from "./video";

export const likeTypeEnum = pgEnum("like_type", ["like", "dislike"]);

export const videoLike = pgTable(
  "video_like",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    type: likeTypeEnum("type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.videoId] }),
    index("video_like_video_id_idx").on(table.videoId),
  ],
);
