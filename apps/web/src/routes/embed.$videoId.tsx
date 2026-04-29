import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { useEffect } from "react";

import { Logo } from "@/components/logo";
import { VideoPlayer } from "@/components/video-player";
import { ApiError, apiClient } from "@/lib/api-client";

interface VideoResponse {
  id: string;
  title: string;
  status: "uploading" | "uploaded" | "processing" | "ready" | "failed";
  duration: number | null;
  streamUrl: string | null;
  thumbnailUrl: string | null;
  storyboardUrl: string | null;
  storyboard: {
    interval: number;
    cols: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
  } | null;
}

interface EmbedSearchParams {
  t?: number;
}

export const Route = createFileRoute("/embed/$videoId")({
  component: EmbedPage,
  validateSearch: (search: Record<string, unknown>): EmbedSearchParams => {
    const t = Number(search.t);
    return { t: Number.isFinite(t) && t > 0 ? Math.floor(t) : undefined };
  },
});

function abs(path: string | null): string | undefined {
  if (!path) return undefined;
  return `${env.VITE_SERVER_URL}${path}`;
}

function useLockBodyScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.cssText;
    const prevBody = body.style.cssText;
    html.style.margin = "0";
    html.style.height = "100%";
    html.style.overflow = "hidden";
    body.style.margin = "0";
    body.style.height = "100%";
    body.style.overflow = "hidden";
    return () => {
      html.style.cssText = prevHtml;
      body.style.cssText = prevBody;
    };
  }, []);
}

function EmbedPage() {
  const { videoId } = Route.useParams();
  const { t: tParam } = Route.useSearch();

  useLockBodyScroll();

  const { data: video, error } = useQuery<VideoResponse>({
    queryKey: ["embed-video", videoId],
    queryFn: () => apiClient<VideoResponse>(`/api/videos/${videoId}`),
  });

  if (error || !video) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black text-sm text-white/70">
        {status === 404 ? "Video not available" : "Failed to load"}
      </div>
    );
  }

  const watchUrl = `${env.VITE_WEB_URL}/watch/${video.id}`;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <VideoPlayer
        manifestUrl={abs(video.streamUrl)}
        thumbnailUrl={abs(video.thumbnailUrl) ?? null}
        storyboard={
          video.storyboard && video.storyboardUrl
            ? {
                url: abs(video.storyboardUrl)!,
                interval: video.storyboard.interval,
                cols: video.storyboard.cols,
                rows: video.storyboard.rows,
                tileWidth: video.storyboard.tileWidth,
                tileHeight: video.storyboard.tileHeight,
              }
            : null
        }
        initialTime={tParam ?? 0}
      />
      <a
        href={watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Watch on ${env.VITE_APP_NAME}`}
        className="pointer-events-auto absolute left-3 top-3 z-10 rounded-lg bg-black/40 px-2 py-1.5 backdrop-blur-sm transition-opacity hover:bg-black/60"
      >
        <Logo />
      </a>
    </div>
  );
}
