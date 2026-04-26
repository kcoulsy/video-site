ALTER TABLE "video" ADD COLUMN "thumbnail_stills_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "thumbnail_still_index" integer;