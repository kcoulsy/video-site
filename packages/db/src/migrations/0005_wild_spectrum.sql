CREATE TABLE "user_recs" (
	"user_id" text NOT NULL,
	"video_id" text NOT NULL,
	"score" real NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_recs_user_id_video_id_pk" PRIMARY KEY("user_id","video_id")
);
--> statement-breakpoint
CREATE TABLE "user_similarity" (
	"user_id" text NOT NULL,
	"other_user_id" text NOT NULL,
	"score" real NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_similarity_user_id_other_user_id_pk" PRIMARY KEY("user_id","other_user_id")
);
--> statement-breakpoint
CREATE TABLE "video_similarity" (
	"video_id" text NOT NULL,
	"other_video_id" text NOT NULL,
	"score" real NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "video_similarity_video_id_other_video_id_pk" PRIMARY KEY("video_id","other_video_id")
);
--> statement-breakpoint
ALTER TABLE "view_event" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "user_recs" ADD CONSTRAINT "user_recs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_recs" ADD CONSTRAINT "user_recs_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_similarity" ADD CONSTRAINT "user_similarity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_similarity" ADD CONSTRAINT "user_similarity_other_user_id_user_id_fk" FOREIGN KEY ("other_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_similarity" ADD CONSTRAINT "video_similarity_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_similarity" ADD CONSTRAINT "video_similarity_other_video_id_video_id_fk" FOREIGN KEY ("other_video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_recs_user_id_score_idx" ON "user_recs" USING btree ("user_id","score");--> statement-breakpoint
CREATE INDEX "user_similarity_user_id_score_idx" ON "user_similarity" USING btree ("user_id","score");--> statement-breakpoint
CREATE INDEX "video_similarity_video_id_score_idx" ON "video_similarity" USING btree ("video_id","score");--> statement-breakpoint
CREATE INDEX "view_event_user_id_viewed_at_idx" ON "view_event" USING btree ("user_id","viewed_at");--> statement-breakpoint
CREATE INDEX "view_event_session_id_viewed_at_idx" ON "view_event" USING btree ("session_id","viewed_at");