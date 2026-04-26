import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import {
  CheckCircle,
  Edit2,
  ExternalLink,
  Eye,
  Film,
  Loader2,
  MoreHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";

import { VideoStatusBadge, type VideoStatus } from "@/components/video-status-badge";
import { getUser } from "@/functions/get-user";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDuration, formatRelativeTime, formatViewCount } from "@/lib/format";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Your videos — Watchbox" }] }),
  beforeLoad: async () => {
    const session = await getUser();
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
});

interface DashboardVideo {
  id: string;
  title: string;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  status: VideoStatus;
  visibility: "public" | "unlisted" | "private";
  duration: number | null;
  viewCount: number;
  likeCount: number;
  createdAt: string;
  processingError: string | null;
}

interface MyVideosResponse {
  items: DashboardVideo[];
  page: number;
  limit: number;
  total: number;
}

function DashboardPage() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MyVideosResponse>({
    queryKey: ["videos", "my"],
    queryFn: () => apiClient<MyVideosResponse>("/api/videos/my"),
  });

  const videos = data?.items ?? [];
  const readyCount = videos.filter((v) => v.status === "ready").length;
  const processingCount = videos.filter(
    (v) => v.status === "processing" || v.status === "uploading",
  ).length;
  const totalViews = videos.reduce((sum, v) => sum + v.viewCount, 0);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your videos, {session?.user.name}
          </p>
        </div>
        <Button render={<Link to="/upload" />} className="gap-2">
          <Upload className="h-4 w-4" />
          Upload Video
        </Button>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Videos", value: String(videos.length), Icon: Film },
          { label: "Total Views", value: formatViewCount(totalViews), Icon: Eye },
          { label: "Ready", value: String(readyCount), Icon: CheckCircle },
          {
            label: "Processing",
            value: String(processingCount),
            Icon: Loader2,
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.Icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">{stat.label}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="border-b border-border bg-card/50 px-4 py-3">
          <h2 className="text-sm font-medium">Your Videos</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Film className="h-12 w-12 text-muted-foreground/20" />
            <p className="mt-4 text-sm text-muted-foreground">No videos yet</p>
            <Button variant="outline" className="mt-4 gap-2" render={<Link to="/upload" />}>
              <Upload className="h-4 w-4" />
              Upload your first video
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {videos.map((video) => (
              <VideoRow
                key={video.id}
                video={video}
                onDeleted={() => {
                  void queryClient.invalidateQueries({
                    queryKey: ["videos", "my"],
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

interface StatusResponse {
  status: VideoStatus;
  progress: { stage: string; percent: number } | null;
  error: string | null;
}

function useVideoStatus(videoId: string, status: VideoStatus) {
  const queryClient = useQueryClient();
  const isActive = status === "uploaded" || status === "processing";

  return useQuery<StatusResponse>({
    queryKey: ["video-status", videoId],
    queryFn: async () => {
      const result = await apiClient<StatusResponse>(`/api/videos/${videoId}/status`);
      if (result.status === "ready" || result.status === "failed") {
        void queryClient.invalidateQueries({ queryKey: ["videos", "my"] });
      }
      return result;
    },
    enabled: isActive,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "ready" || s === "failed" ? false : 3000;
    },
  });
}

function VideoRow({
  video,
  onDeleted,
}: {
  video: DashboardVideo;
  onDeleted: () => void;
}) {
  const liveStatus = useVideoStatus(video.id, video.status);
  const status = liveStatus.data?.status ?? video.status;
  const progress = liveStatus.data?.progress?.percent ?? null;
  const errorMessage = liveStatus.data?.error ?? video.processingError;

  const deleteMutation = useMutation({
    mutationFn: () => apiClient(`/api/videos/${video.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Video deleted");
      onDeleted();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Failed to delete";
      toast.error(msg);
    },
  });

  const isReady = status === "ready";
  const thumbnail = (
    <>
      {video.thumbnailUrl ? (
        <img
          src={`${env.VITE_SERVER_URL}${video.thumbnailUrl}`}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
          <Film className="h-6 w-6 text-muted-foreground/20" />
        </div>
      )}
      {video.duration != null && (
        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
          {formatDuration(video.duration)}
        </span>
      )}
      {(status === "processing" || status === "uploading") && progress != null && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="text-xs font-medium text-white tabular-nums">
            {Math.round(progress)}%
          </span>
        </div>
      )}
    </>
  );

  return (
    <div className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-secondary/30">
      {isReady ? (
        <Link
          to="/watch/$videoId"
          params={{ videoId: video.id }}
          className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-secondary"
        >
          {thumbnail}
        </Link>
      ) : (
        <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-secondary">
          {thumbnail}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {isReady ? (
          <Link
            to="/watch/$videoId"
            params={{ videoId: video.id }}
            className="block truncate text-sm font-medium hover:underline"
          >
            {video.title}
          </Link>
        ) : (
          <h3 className="truncate text-sm font-medium">{video.title}</h3>
        )}
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <VideoStatusBadge status={status} progressPercent={progress} />
          <span className="capitalize">{video.visibility}</span>
          <span>{formatRelativeTime(video.createdAt)}</span>
        </div>
        {status === "failed" && errorMessage ? (
          <p className="mt-1 truncate text-xs text-red-400/80">{errorMessage}</p>
        ) : null}
      </div>

      <div className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
        <div className="text-right">
          <p className="font-medium text-foreground">{formatViewCount(video.viewCount)}</p>
          <p className="text-xs">views</p>
        </div>
        <div className="text-right">
          <p className="font-medium text-foreground">{video.likeCount}</p>
          <p className="text-xs">likes</p>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="bg-card">
          {status === "ready" && (
            <DropdownMenuItem render={<Link to="/watch/$videoId" params={{ videoId: video.id }} />}>
              <ExternalLink className="mr-2 h-4 w-4" />
              View
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            render={
              <Link to="/videos/$videoId/edit" params={{ videoId: video.id }} />
            }
          >
            <Edit2 className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => deleteMutation.mutate()}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
