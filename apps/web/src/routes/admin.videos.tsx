import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Film, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";
import { Input } from "@video-site/ui/components/input";
import { env } from "@video-site/env/web";

import { VideoStatusBadge, type VideoStatus } from "@/components/video-status-badge";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDuration, formatRelativeTime, formatViewCount } from "@/lib/format";

export const Route = createFileRoute("/admin/videos")({
  component: AdminVideos,
});

interface AdminVideo {
  id: string;
  title: string;
  status: VideoStatus;
  visibility: "public" | "unlisted" | "private";
  duration: number | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  thumbnailUrl: string | null;
  createdAt: string;
  owner: { id: string; name: string; email: string };
}

interface VideosResponse {
  items: AdminVideo[];
  page: number;
  limit: number;
  total: number;
}

const PAGE_SIZE = 25;

function AdminVideos() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [visibility, setVisibility] = useState<string>("");

  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (visibility) params.set("visibility", visibility);

  const { data, isLoading } = useQuery<VideosResponse>({
    queryKey: ["admin", "videos", page, q, status, visibility],
    queryFn: () => apiClient<VideosResponse>(`/api/admin/videos?${params}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient(`/api/admin/videos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Video deleted");
      void queryClient.invalidateQueries({ queryKey: ["admin", "videos"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Videos</h1>
      <p className="mt-1 text-sm text-muted-foreground">{total} total</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Input
          placeholder="Search title or description"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="uploading">Uploading</option>
          <option value="uploaded">Uploaded</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={visibility}
          onChange={(e) => {
            setVisibility(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="">All visibility</option>
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
        </select>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
            No videos match
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((video) => (
              <div
                key={video.id}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-secondary/30"
              >
                <div className="relative aspect-video w-28 shrink-0 overflow-hidden bg-secondary">
                  {video.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${env.VITE_SERVER_URL}${video.thumbnailUrl}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Film className="h-5 w-5 text-muted-foreground/30" />
                    </div>
                  )}
                  {video.duration != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
                      {formatDuration(video.duration)}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium">{video.title}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <VideoStatusBadge status={video.status} progressPercent={null} />
                    <span className="capitalize">{video.visibility}</span>
                    <span>{formatRelativeTime(video.createdAt)}</span>
                    <span>by {video.owner.name}</span>
                  </div>
                </div>

                <div className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
                  <div className="text-right">
                    <p className="font-medium text-foreground">
                      {formatViewCount(video.viewCount)}
                    </p>
                    <p className="text-xs">views</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-foreground">{video.commentCount}</p>
                    <p className="text-xs">comments</p>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
                    <MoreHorizontal className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-card">
                    {video.status === "ready" && (
                      <DropdownMenuItem
                        render={<Link to="/watch/$videoId" params={{ videoId: video.id }} />}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        View
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        if (confirm(`Delete "${video.title}"? This cannot be undone.`)) {
                          deleteMutation.mutate(video.id);
                        }
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
