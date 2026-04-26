ALTER TABLE "video" ALTER COLUMN "view_count" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "video" ALTER COLUMN "like_count" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "video" ALTER COLUMN "dislike_count" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "video" ALTER COLUMN "comment_count" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banner_path" text;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "storyboard_path" text;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "storyboard_interval" integer;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "storyboard_cols" integer;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "storyboard_rows" integer;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "storyboard_tile_width" integer;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "storyboard_tile_height" integer;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_handle_unique" UNIQUE("handle");