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
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as tus from "tus-js-client";
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
import { formatDuration, formatFileSize, formatRelativeTime, formatViewCount } from "@/lib/format";

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
  isDraft: number;
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
    queryFn: () => apiClient<MyVideosResponse>(`/api/videos/my?page=${page}&limit=${PAGE_SIZE}`),
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

      <DashboardUploadDropzone
        onUploadStarted={() => {
          void queryClient.invalidateQueries({ queryKey: ["videos", "my"] });
        }}
      />

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

interface CreateVideoResponse {
  id: string;
}

interface DraftUpload {
  id: string;
  name: string;
  size: number;
  phase: "hashing" | "uploading" | "processing" | "failed";
  progress: number;
}

async function hashFileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isVideoFile(file: File): boolean {
  return (
    file.type.startsWith("video/") ||
    /\.(mp4|mov|mkv|webm|avi|m4v|flv|3gp|mpg|mpeg|ts)$/i.test(file.name)
  );
}

function DashboardUploadDropzone({ onUploadStarted }: { onUploadStarted: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<DraftUpload[]>([]);
  const dragDepth = useRef(0);

  const updateUpload = useCallback((id: string, update: Partial<DraftUpload>) => {
    setUploads((current) =>
      current.map((upload) => (upload.id === id ? { ...upload, ...update } : upload)),
    );
  }, []);

  const uploadDraft = useCallback(
    async (file: File) => {
      const id = crypto.randomUUID();
      setUploads((current) => [
        ...current,
        { id, name: file.name, size: file.size, phase: "hashing", progress: 0 },
      ]);

      try {
        const fileHash = await hashFileSha256(file);
        updateUpload(id, { phase: "uploading" });
        const created = await apiClient<CreateVideoResponse>("/api/videos", {
          method: "POST",
          body: JSON.stringify({
            title: file.name.replace(/\.[^.]+$/, "") || "Untitled video",
            filename: file.name,
            mimeType: file.type || "video/mp4",
            fileSize: file.size,
            fileHash,
            isDraft: true,
          }),
        });
        onUploadStarted();

        await new Promise<void>((resolve, reject) => {
          const upload = new tus.Upload(file, {
            endpoint: `${env.VITE_SERVER_URL}/api/uploads`,
            retryDelays: [0, 1000, 3000, 5000],
            chunkSize: 8 * 1024 * 1024,
            fingerprint: async () =>
              `watchbox:${env.VITE_SERVER_URL}:${file.name}:${file.size}:${file.lastModified}`,
            onBeforeRequest: (request) => {
              (request.getUnderlyingObject() as XMLHttpRequest).withCredentials = true;
            },
            metadata: {
              videoId: created.id,
              filename: file.name,
              filetype: file.type || "video/mp4",
            },
            onError: reject,
            onProgress: (uploaded, total) => {
              const progress = Math.round((uploaded / total) * 100);
              updateUpload(id, { phase: progress >= 100 ? "processing" : "uploading", progress });
            },
            onSuccess: () => resolve(),
          });
          upload.start();
        });
        updateUpload(id, { phase: "processing", progress: 100 });
        toast.success(`${file.name} uploaded as a draft`);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : `Failed to upload ${file.name}`;
        updateUpload(id, { phase: "failed" });
        toast.error(message);
      }
    },
    [onUploadStarted, updateUpload],
  );

  const acceptFiles = useCallback(
    (files: FileList | File[]) => {
      const videoFiles = Array.from(files).filter(isVideoFile);
      if (videoFiles.length === 0) {
        toast.error("Drop one or more video files to upload.");
        return;
      }
      if (videoFiles.length !== Array.from(files).length)
        toast.error("Non-video files were skipped.");
      void Promise.all(videoFiles.map(uploadDraft));
    },
    [uploadDraft],
  );

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragOver(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      acceptFiles(event.dataTransfer.files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [acceptFiles]);

  return (
    <>
      {dragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-primary bg-primary/10 px-12 py-10 text-center">
            <Upload className="mx-auto mb-3 h-12 w-12 text-primary" />
            <p className="text-lg font-medium">Drop videos to upload as drafts</p>
          </div>
        </div>
      ) : null}
      {uploads.length > 0 ? (
        <div className="mb-8 overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-card/50 px-4 py-3">
            <h2 className="text-sm font-medium">Draft uploads</h2>
          </div>
          <div className="divide-y divide-border">
            {uploads.map((upload) => (
              <div key={upload.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                {upload.phase === "failed" ? (
                  <X className="h-4 w-4 text-red-400" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{upload.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(upload.size)}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {upload.phase === "hashing"
                    ? "Checking file"
                    : upload.phase === "processing"
                      ? "Processing"
                      : upload.phase === "failed"
                        ? "Failed"
                        : `${upload.progress}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
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
          className="adult-thumbnail h-full w-full object-cover"
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
          {video.isDraft === 1 ? <span>Draft</span> : null}
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
