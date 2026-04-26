CREATE TABLE "comment_like" (
	"user_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comment_like_user_id_comment_id_pk" PRIMARY KEY("user_id","comment_id")
);
--> statement-breakpoint
CREATE TABLE "watch_later" (
	"user_id" text NOT NULL,
	"video_id" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "watch_later_user_id_video_id_pk" PRIMARY KEY("user_id","video_id")
);
--> statement-breakpoint
CREATE TABLE "playlist" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"visibility" "video_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlist_item" (
	"playlist_id" text NOT NULL,
	"video_id" text NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_item_playlist_id_video_id_pk" PRIMARY KEY("playlist_id","video_id")
);
--> statement-breakpoint
CREATE TABLE "view_event" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"user_id" text,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_like" ADD CONSTRAINT "comment_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_like" ADD CONSTRAINT "comment_like_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_later" ADD CONSTRAINT "watch_later_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_later" ADD CONSTRAINT "watch_later_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist" ADD CONSTRAINT "playlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_item" ADD CONSTRAINT "playlist_item_playlist_id_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_item" ADD CONSTRAINT "playlist_item_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_event" ADD CONSTRAINT "view_event_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_event" ADD CONSTRAINT "view_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_like_comment_id_idx" ON "comment_like" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "watch_later_user_id_added_at_idx" ON "watch_later" USING btree ("user_id","added_at");--> statement-breakpoint
CREATE INDEX "playlist_user_id_idx" ON "playlist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "playlist_user_id_created_at_idx" ON "playlist" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "playlist_item_playlist_id_position_idx" ON "playlist_item" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE INDEX "view_event_video_id_viewed_at_idx" ON "view_event" USING btree ("video_id","viewed_at");--> statement-breakpoint
CREATE INDEX "view_event_viewed_at_idx" ON "view_event" USING btree ("viewed_at");