CREATE TYPE "public"."moderation_action" AS ENUM('ban', 'unban', 'suspend', 'unsuspend', 'mute', 'unmute', 'remove_video', 'restore_video', 'hard_delete_video', 'remove_comment', 'restore_comment', 'hard_delete_comment', 'role_change', 'delete_user', 'resolve_report', 'dismiss_report');--> statement-breakpoint
CREATE TYPE "public"."moderation_target" AS ENUM('user', 'video', 'comment', 'report');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'sexual', 'violence', 'illegal', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('video', 'comment');--> statement-breakpoint
CREATE TABLE "moderation_action" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" "moderation_action" NOT NULL,
	"target_type" "moderation_target" NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"target_type" "report_target" NOT NULL,
	"target_id" text NOT NULL,
	"reason_category" "report_reason" NOT NULL,
	"reason" text,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"resolution_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspended_until" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspend_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspended_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "muted_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "mute_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "muted_by" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "removed_by" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "removal_reason" text;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "removed_by" text;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "removal_reason" text;--> statement-breakpoint
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_action_created_at_idx" ON "moderation_action" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "moderation_action_target_idx" ON "moderation_action" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "moderation_action_actor_idx" ON "moderation_action" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "report_status_created_at_idx" ON "report" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_target_idx" ON "report" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "report_reporter_idx" ON "report" USING btree ("reporter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_unique_pending_idx" ON "report" USING btree ("reporter_id","target_type","target_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "user_banned_suspended_idx" ON "user" USING btree ("banned_at","suspended_until");--> statement-breakpoint
CREATE INDEX "video_deleted_at_idx" ON "video" USING btree ("deleted_at");