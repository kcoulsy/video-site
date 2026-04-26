import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { Clock, History, Play, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import { env } from "@video-site/env/web";

import Loader from "@/components/loader";
import { WatchProgressBar } from "@/components/watch-progress-bar";
import { getUser } from "@/functions/get-user";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDuration, formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "Watch history — Watchbox" }] }),
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

interface HistoryItem {
  videoId: string;
  watchedSeconds: number;
  totalDuration: number;
  progressPercent: number;
  completedAt: string | null;
  lastWatchedAt: string;
  video: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    duration: number | null;
    status: string;
    user: { id: string; name: string; image: string | null };
  };
}

interface HistoryResponse {
  items: HistoryItem[];
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

function HistoryPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<HistoryResponse>({
    queryKey: ["history"],
    queryFn: () => apiClient<HistoryResponse>("/api/history?limit=50"),
  });

  const removeMutation = useMutation({
    mutationFn: (videoId: string) => apiClient(`/api/history/${videoId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove from history");
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => apiClient(`/api/history`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"] });
      toast.success("Watch history cleared");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to clear history");
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
        <h1 className="text-2xl font-semibold">Couldn't load history</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please try again in a moment.</p>
      </div>
    );
  }

  const items = data?.items ?? [];
  const continueItems = items.filter((it) => it.progressPercent < 0.9);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="mb-8 flex items-center gap-3">
          <History className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Watch History</h1>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <History className="h-12 w-12 text-muted-foreground/30" />
          <p className="mt-4 text-sm text-muted-foreground">No watch history yet</p>
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
          <History className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Watch History</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={clearMutation.isPending}
          onClick={() => {
            if (window.confirm("Clear your entire watch history?")) {
              clearMutation.mutate();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
          Clear all
        </Button>
      </div>

      {continueItems.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            <Play className="h-4 w-4" />
            Continue Watching
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {continueItems.map((item) => (
              <ContinueCard key={`continue-${item.videoId}`} item={item} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          <Clock className="h-4 w-4" />
          All History
        </h2>
        <div className="space-y-2">
          {items.map((item) => (
            <HistoryRow
              key={`${item.videoId}-history`}
              item={item}
              onRemove={() => removeMutation.mutate(item.videoId)}
              removing={removeMutation.isPending && removeMutation.variables === item.videoId}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ContinueCard({ item }: { item: HistoryItem }) {
  const thumbnail = absoluteUrl(item.video.thumbnailUrl);
  return (
    <Link to="/watch/$videoId" params={{ videoId: item.videoId }} className="group block">
      <div className="relative aspect-video overflow-hidden bg-secondary">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={item.video.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <Play className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}

        <WatchProgressBar progressPercent={item.progressPercent} />

        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 backdrop-blur-sm">
            <Play className="h-4 w-4 fill-white text-white" />
            <span className="text-sm font-medium text-white">Resume</span>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <h3 className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">
          {item.video.title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDuration(item.watchedSeconds)} /{" "}
          {item.video.duration != null
            ? formatDuration(item.video.duration)
            : formatDuration(item.totalDuration)}{" "}
          &middot; {item.video.user.name}
        </p>
      </div>
    </Link>
  );
}

function HistoryRow({
  item,
  onRemove,
  removing,
}: {
  item: HistoryItem;
  onRemove: () => void;
  removing: boolean;
}) {
  const isComplete = item.progressPercent >= 0.9;
  const thumbnail = absoluteUrl(item.video.thumbnailUrl);

  return (
    <div className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-secondary/50">
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
          <WatchProgressBar progressPercent={item.progressPercent} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">
            {item.video.title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.video.user.name}</p>
          <p className="text-xs text-muted-foreground">
            {isComplete ? "Watched" : `${Math.round(item.progressPercent * 100)}% watched`} &middot;{" "}
            {formatRelativeTime(item.lastWatchedAt)}
          </p>
        </div>
      </Link>

      <button
        type="button"
        aria-label="Remove from history"
        disabled={removing}
        onClick={onRemove}
        className="rounded-full p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
