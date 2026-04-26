import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Share2 } from "lucide-react";
import { Button } from "@video-site/ui/components/button";
import { env } from "@video-site/env/web";

import { VideoPlayer } from "@/components/video-player";
import { LikeButton } from "@/components/like-button";
import Loader from "@/components/loader";
import { CommentSection } from "@/components/comments/comment-section";
import { ReportButton } from "@/components/report-button";
import { WatchNext } from "@/components/watch-next";
import { ApiError, apiClient } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { formatDate, formatViewCount } from "@/lib/format";

export const Route = createFileRoute("/watch/$videoId")({
  component: WatchPage,
});

interface VideoResponse {
  id: string;
  title: string;
  description: string | null;
  status: "uploading" | "uploaded" | "processing" | "ready" | "failed";
  visibility: "public" | "unlisted" | "private";
  duration: number | null;
  viewCount: number;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  createdAt: string;
  streamUrl: string | null;
  thumbnailUrl: string | null;
  user: { id: string; name: string; image: string | null };
}

interface ProgressResponse {
  watchedSeconds: number;
  totalDuration: number;
  progressPercent: number;
  completedAt: string | null;
}

const PROGRESS_REPORT_INTERVAL_SECONDS = 10;

function absoluteUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return `${env.VITE_SERVER_URL}${path}`;
}

function WatchPage() {
  const { videoId } = Route.useParams();
  const [cinemaMode, setCinemaMode] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const viewReported = useRef(false);
  const lastReportedTime = useRef(0);
  const videoIdRef = useRef(videoId);
  const durationRef = useRef<number | null>(null);
  const { data: session } = authClient.useSession();
  const isAuthenticated = !!session;

  const {
    data: video,
    isLoading,
    error,
  } = useQuery<VideoResponse>({
    queryKey: ["video", videoId],
    queryFn: () => apiClient<VideoResponse>(`/api/videos/${videoId}`),
  });

  const { data: progress } = useQuery<ProgressResponse>({
    queryKey: ["video-progress", videoId],
    queryFn: () => apiClient<ProgressResponse>(`/api/videos/${videoId}/progress`),
    enabled: isAuthenticated,
    staleTime: Infinity,
  });

  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);

  useEffect(() => {
    durationRef.current = video?.duration ?? null;
  }, [video?.duration]);

  useEffect(() => {
    viewReported.current = false;
    lastReportedTime.current = 0;
  }, [videoId]);

  // Flush progress on unmount / page hide using sendBeacon
  useEffect(() => {
    if (!isAuthenticated) return;

    const flush = () => {
      const watched = lastReportedTime.current;
      const total = durationRef.current;
      if (watched <= 0 || !total || total <= 0) return;
      const url = `${env.VITE_SERVER_URL}/api/videos/${videoIdRef.current}/progress`;
      const body = new Blob(
        [
          JSON.stringify({
            watchedSeconds: Math.floor(watched),
            totalDuration: Math.floor(total),
          }),
        ],
        { type: "application/json" },
      );
      navigator.sendBeacon(url, body);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibility);
      flush();
    };
  }, [isAuthenticated]);

  const reportProgress = (watchedSeconds: number) => {
    const total = durationRef.current;
    if (!total || total <= 0) return;
    apiClient(`/api/videos/${videoIdRef.current}/progress`, {
      method: "POST",
      body: JSON.stringify({
        watchedSeconds: Math.floor(watchedSeconds),
        totalDuration: Math.floor(total),
      }),
    }).catch(() => {
      // fire-and-forget
    });
  };

  const handleTimeUpdate = (time: number) => {
    if (!viewReported.current && time >= 5) {
      viewReported.current = true;
      apiClient(`/api/videos/${videoId}/view`, { method: "POST" }).catch(() => {
        // best-effort — silently ignore
      });
    }

    if (
      isAuthenticated &&
      Math.abs(time - lastReportedTime.current) >= PROGRESS_REPORT_INTERVAL_SECONDS
    ) {
      lastReportedTime.current = time;
      reportProgress(time);
    } else if (time > lastReportedTime.current) {
      // Track the latest time we've seen even between reports, so the
      // unmount/sendBeacon flush can save the most recent position.
      lastReportedTime.current = Math.max(lastReportedTime.current, time);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error || !video) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">
          {status === 404 ? "Video not found" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {status === 404
            ? "This video may have been removed or is private."
            : "Please try again in a moment."}
        </p>
      </div>
    );
  }

  const initialTime = progress && progress.progressPercent < 0.9 ? progress.watchedSeconds : 0;

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-4">
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_402px]">
        <div
          className={
            cinemaMode
              ? "mx-auto w-full max-w-[calc((100vh-6rem)*16/9)] lg:col-span-2"
              : "lg:col-start-1"
          }
        >
          <VideoPlayer
            manifestUrl={absoluteUrl(video.streamUrl)}
            thumbnailUrl={absoluteUrl(video.thumbnailUrl) ?? null}
            initialTime={initialTime}
            onTimeUpdate={handleTimeUpdate}
            cinemaMode={cinemaMode}
            onToggleCinema={() => setCinemaMode((c) => !c)}
          />
        </div>

        <div className="min-w-0 lg:col-start-1">
          <h1 className="text-xl font-semibold leading-snug">{video.title}</h1>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {formatViewCount(video.viewCount)} views &middot; {formatDate(video.createdAt)}
            </p>

            <div className="flex items-center gap-1.5">
              <LikeButton
                videoId={video.id}
                likeCount={video.likeCount}
                dislikeCount={video.dislikeCount}
                isAuthenticated={isAuthenticated}
              />

              <Button variant="secondary" size="sm" className="gap-1.5 rounded-full">
                <Share2 className="h-4 w-4" />
                <span className="hidden sm:inline">Share</span>
              </Button>

              <ReportButton
                targetType="video"
                targetId={video.id}
                isAuthenticated={isAuthenticated}
              />
            </div>
          </div>

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
              </div>
              <Button size="sm" className="rounded-full">
                Subscribe
              </Button>
            </div>

            {video.description ? (
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
            ) : null}
          </div>

          <CommentSection videoId={video.id} commentCount={video.commentCount} />
        </div>

        <aside
          className={`lg:col-start-2 ${cinemaMode ? "" : "lg:row-start-1 lg:row-span-2"}`}
        >
          <WatchNext currentVideoId={video.id} />
        </aside>
      </div>
    </div>
  );
}
