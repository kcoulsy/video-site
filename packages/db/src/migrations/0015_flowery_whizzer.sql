CREATE TABLE "hidden_video" (
	"user_id" text NOT NULL,
	"video_id" text NOT NULL,
	"hidden_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_video_user_id_video_id_pk" PRIMARY KEY("user_id","video_id")
);
--> statement-breakpoint
ALTER TABLE "hidden_video" ADD CONSTRAINT "hidden_video_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hidden_video" ADD CONSTRAINT "hidden_video_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hidden_video_user_id_hidden_at_idx" ON "hidden_video" USING btree ("user_id","hidden_at");--> statement-breakpoint
CREATE INDEX "comment_video_toplevel_created_idx" ON "comment" USING btree ("video_id","created_at" DESC NULLS LAST) WHERE "comment"."parent_id" IS NULL;--> statement-breakpoint
CREATE INDEX "comment_video_root_created_idx" ON "comment" USING btree ("video_id","root_id","created_at");