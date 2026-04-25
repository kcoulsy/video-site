import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  CloudUpload,
  Edit2,
  ExternalLink,
  Eye,
  Film,
  Loader2,
  MoreHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@video-site/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";

import { getUser } from "@/functions/get-user";
import { UploadModal } from "@/components/upload-modal";
import { formatDuration, formatRelativeTime, formatViewCount } from "@/lib/format";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
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

type VideoStatus = "uploading" | "uploaded" | "processing" | "ready" | "failed";

interface DashboardVideo {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  status: VideoStatus;
  visibility: "public" | "unlisted" | "private";
  duration: number | null;
  viewCount: number;
  likeCount: number;
  createdAt: string;
  processingProgress?: number;
}

// Mock data — replace with GET /api/videos?mine=true
const MOCK_VIDEOS: DashboardVideo[] = [
  {
    id: "v1",
    title: "Building a Full-Stack App with TanStack Start",
    thumbnailUrl: null,
    status: "ready",
    visibility: "public",
    duration: 2100,
    viewCount: 12400,
    likeCount: 340,
    createdAt: new Date(Date.now() - 2592000000).toISOString(),
  },
  {
    id: "v2",
    title: "Advanced TypeScript Patterns",
    thumbnailUrl: null,
    status: "processing",
    visibility: "public",
    duration: null,
    viewCount: 0,
    likeCount: 0,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    processingProgress: 65,
  },
  {
    id: "v3",
    title: "React 19 Deep Dive - Untitled Draft",
    thumbnailUrl: null,
    status: "uploading",
    visibility: "private",
    duration: null,
    viewCount: 0,
    likeCount: 0,
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    processingProgress: 42,
  },
  {
    id: "v4",
    title: "Failed Upload Test",
    thumbnailUrl: null,
    status: "failed",
    visibility: "private",
    duration: null,
    viewCount: 0,
    likeCount: 0,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

const STATUS_CONFIG: Record<
  VideoStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  uploading: {
    label: "Uploading",
    icon: <CloudUpload className="h-3.5 w-3.5" />,
    className: "text-blue-400 bg-blue-400/10",
  },
  uploaded: {
    label: "Uploaded",
    icon: <Clock className="h-3.5 w-3.5" />,
    className: "text-yellow-400 bg-yellow-400/10",
  },
  processing: {
    label: "Processing",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    className: "text-amber-400 bg-amber-400/10",
  },
  ready: {
    label: "Ready",
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    className: "text-emerald-400 bg-emerald-400/10",
  },
  failed: {
    label: "Failed",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    className: "text-red-400 bg-red-400/10",
  },
};

function DashboardPage() {
  const { session } = Route.useRouteContext();
  const [uploadOpen, setUploadOpen] = useState(false);

  const readyCount = MOCK_VIDEOS.filter((v) => v.status === "ready").length;
  const processingCount = MOCK_VIDEOS.filter(
    (v) => v.status === "processing" || v.status === "uploading",
  ).length;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your videos, {session?.user.name}
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="gap-2">
          <Upload className="h-4 w-4" />
          Upload Video
        </Button>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Videos", value: String(MOCK_VIDEOS.length), Icon: Film },
          { label: "Total Views", value: formatViewCount(12400), Icon: Eye },
          { label: "Ready", value: String(readyCount), Icon: CheckCircle },
          { label: "Processing", value: String(processingCount), Icon: Loader2 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.Icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">
                {stat.label}
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Video list */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="border-b border-border bg-card/50 px-4 py-3">
          <h2 className="text-sm font-medium">Your Videos</h2>
        </div>

        {MOCK_VIDEOS.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Film className="h-12 w-12 text-muted-foreground/20" />
            <p className="mt-4 text-sm text-muted-foreground">No videos yet</p>
            <Button
              variant="outline"
              className="mt-4 gap-2"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="h-4 w-4" />
              Upload your first video
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {MOCK_VIDEOS.map((video, i) => (
              <VideoRow key={video.id} video={video} index={i} />
            ))}
          </div>
        )}
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}

function VideoRow({
  video,
  index,
}: {
  video: DashboardVideo;
  index: number;
}) {
  const status = STATUS_CONFIG[video.status];

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-secondary/30 animate-fade-slide-up"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
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
        {(video.status === "processing" || video.status === "uploading") &&
          video.processingProgress != null && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <span className="text-xs font-medium text-white">
                {video.processingProgress}%
              </span>
            </div>
          )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium">{video.title}</h3>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
          >
            {status.icon}
            {status.label}
          </span>
          <span className="capitalize">{video.visibility}</span>
          <span>{formatRelativeTime(video.createdAt)}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
        <div className="text-right">
          <p className="font-medium text-foreground">
            {formatViewCount(video.viewCount)}
          </p>
          <p className="text-xs">views</p>
        </div>
        <div className="text-right">
          <p className="font-medium text-foreground">{video.likeCount}</p>
          <p className="text-xs">likes</p>
        </div>
      </div>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="bg-card">
          {video.status === "ready" && (
            <DropdownMenuItem>
              <ExternalLink className="mr-2 h-4 w-4" />
              View
            </DropdownMenuItem>
          )}
          <DropdownMenuItem>
            <Edit2 className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
