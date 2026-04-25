import { bigint, index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const videoStatusEnum = pgEnum("video_status", [
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
]);

export const videoVisibilityEnum = pgEnum("video_visibility", ["public", "unlisted", "private"]);

export const video = pgTable(
  "video",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").default(""),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    status: videoStatusEnum("status").default("uploading").notNull(),
    visibility: videoVisibilityEnum("visibility").default("public").notNull(),

    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    fileSize: bigint("file_size", { mode: "number" }),
    duration: integer("duration"),
    width: integer("width"),
    height: integer("height"),

    rawPath: text("raw_path"),
    manifestPath: text("manifest_path"),
    thumbnailPath: text("thumbnail_path"),

    tusUploadId: text("tus_upload_id"),

    viewCount: integer("view_count").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    dislikeCount: integer("dislike_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),

    tags: text("tags").array(),

    processingError: text("processing_error"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    index("video_user_id_idx").on(table.userId),
    index("video_status_idx").on(table.status),
    index("video_created_at_idx").on(table.createdAt),
    index("video_visibility_status_idx").on(table.visibility, table.status),
  ],
);
