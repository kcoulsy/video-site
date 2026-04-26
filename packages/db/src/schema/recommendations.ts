import { index, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { video } from "./video";

export const videoSimilarity = pgTable(
  "video_similarity",
  {
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    otherVideoId: text("other_video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.videoId, table.otherVideoId] }),
    index("video_similarity_video_id_score_idx").on(table.videoId, table.score),
  ],
);

export const userSimilarity = pgTable(
  "user_similarity",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    otherUserId: text("other_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.otherUserId] }),
    index("user_similarity_user_id_score_idx").on(table.userId, table.score),
  ],
);

export const userRecs = pgTable(
  "user_recs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.videoId] }),
    index("user_recs_user_id_score_idx").on(table.userId, table.score),
  ],
);
