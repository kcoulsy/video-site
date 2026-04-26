import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { video, videoVisibilityEnum } from "./video";

export const playlist = pgTable(
  "playlist",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    visibility: videoVisibilityEnum("visibility").default("private").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("playlist_user_id_idx").on(table.userId),
    index("playlist_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const playlistItem = pgTable(
  "playlist_item",
  {
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlist.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.playlistId, table.videoId] }),
    index("playlist_item_playlist_id_position_idx").on(table.playlistId, table.position),
  ],
);
