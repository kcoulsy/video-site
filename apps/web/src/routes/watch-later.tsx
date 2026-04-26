import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { Bookmark, Play, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import { env } from "@video-site/env/web";

import Loader from "@/components/loader";
import { getUser } from "@/functions/get-user";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDuration, formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/watch-later")({
  component: WatchLaterPage,
  head: () => ({ meta: [{ title: "Watch Later — Watchbox" }] }),
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

interface WatchLaterItem {
  videoId: string;
  addedAt: string;
  video: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    duration: number | null;
    status: string;
    viewCount: number;
    user: { id: string; name: string; image: string | null };
  };
}

interface WatchLaterResponse {
  items: WatchLaterItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

function absoluteUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return `${env.VITE_SERVER_URL}${path}`;
}

function WatchLaterPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<WatchLaterResponse>({
    queryKey: ["watch-later"],
    queryFn: () => apiClient<WatchLaterResponse>("/api/watch-later?limit=50"),
  });

  const removeMutation = useMutation({
    mutationFn: (videoId: string) => apiClient(`/api/watch-later/${videoId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watch-later"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove");
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => apiClient(`/api/watch-later`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watch-later"] });
      toast.success("Watch Later cleared");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to clear");
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Couldn't load Watch Later</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please try again in a moment.</p>
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="mb-8 flex items-center gap-3">
          <Bookmark className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Watch Later</h1>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Bookmark className="h-12 w-12 text-muted-foreground/30" />
          <p className="mt-4 text-sm text-muted-foreground">Nothing saved yet</p>
          <Link to="/" className="mt-4">
            <Button variant="outline">Browse videos</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bookmark className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Watch Later</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={clearMutation.isPending}
          onClick={() => {
            if (window.confirm("Clear all saved videos?")) {
              clearMutation.mutate();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
          Clear all
        </Button>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const thumbnail = absoluteUrl(item.video.thumbnailUrl);
          return (
            <div
              key={item.videoId}
              className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-secondary/50"
            >
              <Link
                to="/watch/$videoId"
                params={{ videoId: item.videoId }}
                className="flex min-w-0 flex-1 items-center gap-4"
              >
                <div className="relative aspect-video w-40 shrink-0 overflow-hidden bg-secondary">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={item.video.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
                      <Play className="h-6 w-6 text-muted-foreground/30" />
                    </div>
                  )}
                  {item.video.duration != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
                      {formatDuration(item.video.duration)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">
                    {item.video.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.video.user.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Saved {formatRelativeTime(item.addedAt)}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                aria-label="Remove from Watch Later"
                disabled={removeMutation.isPending}
                onClick={() => removeMutation.mutate(item.videoId)}
                className="rounded-full p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
