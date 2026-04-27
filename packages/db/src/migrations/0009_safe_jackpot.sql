ALTER TABLE "comment" ADD COLUMN "root_id" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "pinned_at" timestamp;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "creator_hearted_at" timestamp;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_root_id_comment_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_root_id_idx" ON "comment" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "comment_video_pinned_idx" ON "comment" USING btree ("video_id","pinned_at");--> statement-breakpoint
WITH RECURSIVE chain AS (
  SELECT id, parent_id, id AS root FROM "comment" WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, ch.root FROM "comment" c JOIN chain ch ON c.parent_id = ch.id
)
UPDATE "comment" c SET root_id = ch.root FROM chain ch
  WHERE c.id = ch.id AND c.parent_id IS NOT NULL;--> statement-breakpoint
UPDATE "comment" SET parent_id = root_id, depth = 1 WHERE depth >= 2;--> statement-breakpoint
UPDATE "comment" p SET reply_count = (
  SELECT count(*) FROM "comment" c WHERE c.root_id = p.id AND c.deleted_at IS NULL
) WHERE p.parent_id IS NULL;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_depth_chk" CHECK (depth IN (0, 1));