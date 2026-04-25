import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Monitor,
  MonitorOff,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@video-site/ui/components/button";

import { VideoPlayer } from "@/components/video-player";
import { formatDate, formatViewCount } from "@/lib/format";

export const Route = createFileRoute("/watch/$videoId")({
  component: WatchPage,
});

// Mock — replace with loader fetching GET /api/videos/:id
const MOCK_VIDEO = {
  id: "video-1",
  title: "Building a Full-Stack Video Streaming Platform from Scratch",
  description: `In this comprehensive tutorial, we'll walk through building a complete video streaming platform using modern technologies. We'll cover everything from setting up the monorepo structure with Turborepo to implementing DASH streaming with FFmpeg.

Topics covered:
- Project architecture and monorepo setup
- Database schema design with Drizzle ORM
- Video upload with tus resumable uploads
- FFmpeg transcoding pipeline
- DASH adaptive bitrate streaming
- Frontend with TanStack Start and React

This is part 1 of a multi-part series. Make sure to subscribe for updates!`,
  streamUrl: null as string | null,
  thumbnailUrl: null as string | null,
  viewCount: 156000,
  likeCount: 4200,
  dislikeCount: 120,
  createdAt: new Date(Date.now() - 2592000000).toISOString(),
  user: {
    id: "user-1",
    name: "Alex Turner",
    image: null as string | null,
    subscriberCount: 12400,
  },
};

function WatchPage() {
  const { videoId } = Route.useParams();
  const [cinemaMode, setCinemaMode] = useState(false);
  const [liked, setLiked] = useState<"like" | "dislike" | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const viewReported = useRef(false);

  // Cinema mode: toggle data attribute on <html>
  useEffect(() => {
    if (cinemaMode) {
      document.documentElement.setAttribute("data-cinema", "");
    } else {
      document.documentElement.removeAttribute("data-cinema");
    }
    return () => {
      document.documentElement.removeAttribute("data-cinema");
    };
  }, [cinemaMode]);

  const handleTimeUpdate = (time: number) => {
    if (!viewReported.current && time >= 5) {
      viewReported.current = true;
      // TODO: POST /api/videos/${videoId}/view
    }
  };

  const video = MOCK_VIDEO;

  return (
    <>
      {/* Cinema overlay */}
      {cinemaMode && (
        <div
          className="fixed inset-0 z-[45] bg-black/90 animate-fade-in"
          onClick={() => setCinemaMode(false)}
        />
      )}

      <div
        className={`transition-all duration-500 ${cinemaMode ? "relative z-[50]" : ""}`}
      >
        {/* Player */}
        <div
          className={
            cinemaMode
              ? "w-full px-0"
              : "mx-auto max-w-5xl px-4 pt-4"
          }
        >
          <div className={cinemaMode ? "mx-auto max-w-[1400px]" : ""}>
            <VideoPlayer
              manifestUrl={video.streamUrl || undefined}
              thumbnailUrl={video.thumbnailUrl}
              onTimeUpdate={handleTimeUpdate}
            />
          </div>
        </div>

        {/* Video info */}
        <div
          className={`mx-auto max-w-5xl px-4 py-4 ${cinemaMode ? "opacity-60 transition-opacity hover:opacity-100" : ""}`}
        >
          <h1 className="text-xl font-semibold leading-snug">{video.title}</h1>

          {/* Meta row */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {formatViewCount(video.viewCount)} views &middot;{" "}
              {formatDate(video.createdAt)}
            </p>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              {/* Like / Dislike */}
              <div className="flex items-center overflow-hidden rounded-full bg-secondary">
                <button
                  onClick={() =>
                    setLiked(liked === "like" ? null : "like")
                  }
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                    liked === "like"
                      ? "text-primary"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  <ThumbsUp
                    className={`h-4 w-4 ${liked === "like" ? "fill-primary" : ""}`}
                  />
                  {formatViewCount(
                    video.likeCount + (liked === "like" ? 1 : 0),
                  )}
                </button>
                <div className="h-6 w-px bg-border" />
                <button
                  onClick={() =>
                    setLiked(liked === "dislike" ? null : "dislike")
                  }
                  className={`flex items-center px-4 py-2 transition-colors ${
                    liked === "dislike"
                      ? "text-foreground"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  <ThumbsDown
                    className={`h-4 w-4 ${liked === "dislike" ? "fill-foreground" : ""}`}
                  />
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5 rounded-full"
              >
                <Share2 className="h-4 w-4" />
                <span className="hidden sm:inline">Share</span>
              </Button>

              {/* Cinema mode toggle */}
              <Button
                variant={cinemaMode ? "default" : "secondary"}
                size="sm"
                className="gap-1.5 rounded-full"
                onClick={() => setCinemaMode(!cinemaMode)}
              >
                {cinemaMode ? (
                  <>
                    <MonitorOff className="h-4 w-4" />
                    <span className="hidden sm:inline">Exit Cinema</span>
                  </>
                ) : (
                  <>
                    <Monitor className="h-4 w-4" />
                    <span className="hidden sm:inline">Cinema</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Channel + description card */}
          <div className="mt-4 rounded-xl bg-secondary/50 p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                {video.user.image ? (
                  <img
                    src={video.user.image}
                    alt={video.user.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
                    {video.user.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{video.user.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatViewCount(video.user.subscriberCount)} subscribers
                </p>
              </div>
              <Button size="sm" className="rounded-full">
                Subscribe
              </Button>
            </div>

            <div className="mt-3">
              <div className={descExpanded ? "" : "line-clamp-3"}>
                <p className="whitespace-pre-line text-sm text-foreground/80">
                  {video.description}
                </p>
              </div>
              <button
                onClick={() => setDescExpanded(!descExpanded)}
                className="mt-2 flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {descExpanded ? (
                  <>
                    Show less <ChevronUp className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Show more <ChevronDown className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Comments placeholder */}
          <div className="mb-12 mt-6">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Comments</h2>
              <span className="text-sm text-muted-foreground">
                Coming soon
              </span>
            </div>
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/20" />
              <p className="mt-3 text-sm text-muted-foreground">
                Comments will be available in a future update
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
