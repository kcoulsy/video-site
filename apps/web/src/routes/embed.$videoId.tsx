import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@video-site/env/web";

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

function EmbedPage() {
  const { videoId } = Route.useParams();
  const { t: tParam } = Route.useSearch();

  const { data: video, error } = useQuery<VideoResponse>({
    queryKey: ["embed-video", videoId],
    queryFn: () => apiClient<VideoResponse>(`/api/videos/${videoId}`),
  });

  if (error || !video) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="flex h-svh items-center justify-center bg-black text-sm text-white/70">
        {status === 404 ? "Video not available" : "Failed to load"}
      </div>
    );
  }

  return (
    <div className="h-svh w-full bg-black">
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
    </div>
  );
}
