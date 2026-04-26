CREATE TABLE "removed_video_hash" (
	"hash" text PRIMARY KEY NOT NULL,
	"original_video_id" text,
	"removed_by" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "file_hash" text;--> statement-breakpoint
ALTER TABLE "removed_video_hash" ADD CONSTRAINT "removed_video_hash_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_file_hash_idx" ON "video" USING btree ("file_hash");