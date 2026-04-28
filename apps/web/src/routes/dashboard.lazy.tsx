import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import {
  ChartBar,
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
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";

import { Pagination } from "@/components/pagination";
import { VideoStatusBadge, type VideoStatus } from "@/components/video-status-badge";
import { ViewsBarChart } from "@/components/views-bar-chart";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDuration, formatRelativeTime, formatViewCount } from "@/lib/format";

const PAGE_SIZE = 24;

export const Route = createLazyFileRoute("/dashboard")({
  component: DashboardPage,
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
  const { page: pageParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = pageParam ?? 1;

  const { data, isLoading } = useQuery<MyVideosResponse>({
    queryKey: ["videos", "my", page],
    queryFn: () =>
      apiClient<MyVideosResponse>(`/api/videos/my?page=${page}&limit=${PAGE_SIZE}`),
    placeholderData: (prev) => prev,
  });

  const videos = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 0;
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
          { label: "Total Videos", value: String(total), Icon: Film },
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

      <CreatorAnalyticsSection />

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

      <Pagination
        page={page}
        totalPages={totalPages}
        onChange={(next) =>
          navigate({
            search: (prev) => ({ ...prev, page: next === 1 ? undefined : next }),
          })
        }
      />
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

function VideoRow({ video, onDeleted }: { video: DashboardVideo; onDeleted: () => void }) {
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
            render={<Link to="/videos/$videoId/analytics" params={{ videoId: video.id }} />}
          >
            <ChartBar className="mr-2 h-4 w-4" />
            Analytics
          </DropdownMenuItem>
          <DropdownMenuItem
            render={<Link to="/videos/$videoId/edit" params={{ videoId: video.id }} />}
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

interface CreatorAnalyticsResponse {
  range: "7d" | "30d" | "90d";
  rangeViews: number;
  viewsByDay: { date: string; views: number }[];
  topVideos: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    viewsInRange: number;
    totalViews: number;
  }[];
}

function CreatorAnalyticsSection() {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const { data, isLoading } = useQuery<CreatorAnalyticsResponse>({
    queryKey: ["creator-analytics", range],
    queryFn: () => apiClient<CreatorAnalyticsResponse>(`/api/creator/analytics?range=${range}`),
  });

  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <ChartBar className="h-4 w-4" />
          <h2 className="text-sm font-medium">Channel analytics</h2>
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as "7d" | "30d" | "90d")}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-[1fr_280px]">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Views in range</p>
          <p className="mt-1 text-2xl font-semibold">
            {isLoading ? "—" : formatViewCount(data?.rangeViews ?? 0)}
          </p>
          <div className="mt-3">
            <ViewsBarChart data={data?.viewsByDay ?? []} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Top videos</p>
          <div className="space-y-1">
            {(data?.topVideos ?? []).slice(0, 5).map((v, i) => (
              <Link
                key={v.id}
                to="/videos/$videoId/analytics"
                params={{ videoId: v.id }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/50"
              >
                <span className="w-4 text-muted-foreground">{i + 1}</span>
                <span className="line-clamp-1 flex-1">{v.title}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatViewCount(v.viewsInRange)}
                </span>
              </Link>
            ))}
            {(data?.topVideos ?? []).length === 0 && !isLoading && (
              <p className="px-2 py-2 text-xs text-muted-foreground">No views yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
