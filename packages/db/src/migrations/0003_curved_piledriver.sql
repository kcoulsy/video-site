ALTER TYPE "public"."moderation_action_kind" ADD VALUE 'approve_video';--> statement-breakpoint
ALTER TYPE "public"."moderation_action_kind" ADD VALUE 'approve_comment';--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
CREATE INDEX "comment_reviewed_at_idx" ON "comment" USING btree ("reviewed_at");--> statement-breakpoint
CREATE INDEX "video_reviewed_at_idx" ON "video" USING btree ("reviewed_at");--> statement-breakpoint
UPDATE "video" SET "reviewed_at" = now() WHERE "reviewed_at" IS NULL;--> statement-breakpoint
UPDATE "comment" SET "reviewed_at" = now() WHERE "reviewed_at" IS NULL;