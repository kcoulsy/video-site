import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import { env } from "@video-site/env/web";

import Loader from "@/components/loader";
import { PlaylistCard, type PlaylistCardData } from "@/components/playlist-card";
import { VideoGrid } from "@/components/video-grid";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/u/$handle")({
  component: ProfilePage,
});

interface ProfileVideo {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: string;
  user: { id: string; name: string; image: string | null };
}

interface ProfileResponse {
  user: {
    id: string;
    name: string;
    handle: string | null;
    bio: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    createdAt: string;
  };
  videos: ProfileVideo[];
  counts: { videos: number; playlists: number; subscribers: number };
  viewerIsSubscribed: boolean;
  isOwner: boolean;
}

interface PlaylistsResponse {
  items: (PlaylistCardData & { description: string | null })[];
}

function abs(path: string | null): string | null {
  if (!path) return null;
  return `${env.VITE_SERVER_URL}${path}`;
}

type Tab = "videos" | "playlists";

function ProfilePage() {
  const { handle } = Route.useParams();
  const [tab, setTab] = useState<Tab>("videos");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<ProfileResponse>({
    queryKey: ["profile", handle],
    queryFn: () => apiClient<ProfileResponse>(`/api/profile/${handle}`),
  });

  const subscribeMutation = useMutation({
    mutationFn: async (next: boolean) =>
      apiClient<{ subscribed: boolean }>(`/api/channels/${handle}/subscribe`, {
        method: next ? "POST" : "DELETE",
      }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["profile", handle] });
      const prev = queryClient.getQueryData<ProfileResponse>(["profile", handle]);
      if (prev) {
        queryClient.setQueryData<ProfileResponse>(["profile", handle], {
          ...prev,
          viewerIsSubscribed: next,
          counts: {
            ...prev.counts,
            subscribers: Math.max(0, prev.counts.subscribers + (next ? 1 : -1)),
          },
        });
      }
      return { prev };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["profile", handle], ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed to update subscription");
    },
  });

  const playlistsQuery = useQuery<PlaylistsResponse>({
    queryKey: ["profile", handle, "playlists"],
    queryFn: () => apiClient<PlaylistsResponse>(`/api/users/${handle}/playlists`),
    enabled: tab === "playlists",
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error || !data) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">
          {status === 404 ? "Profile not found" : "Something went wrong"}
        </h1>
      </div>
    );
  }

  const { user, videos, counts, viewerIsSubscribed, isOwner } = data;
  const banner = abs(user.bannerUrl);
  const avatar = abs(user.avatarUrl);

  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "videos", label: "Videos", count: counts.videos },
    { value: "playlists", label: "Playlists", count: counts.playlists },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 pt-4">
      <div className="relative h-40 w-full overflow-hidden rounded-xl bg-secondary sm:h-56">
        {banner ? (
          <img src={banner} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-secondary to-secondary/40" />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div className="-mt-12 h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 border-background bg-secondary sm:h-32 sm:w-32">
          {avatar ? (
            <img src={avatar} alt={user.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-muted-foreground">
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{user.name}</h1>
          {user.handle && <p className="text-sm text-muted-foreground">@{user.handle}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {counts.subscribers.toLocaleString()}{" "}
            {counts.subscribers === 1 ? "subscriber" : "subscribers"} &middot; {counts.videos}{" "}
            {counts.videos === 1 ? "video" : "videos"} &middot; Joined {formatDate(user.createdAt)}
          </p>
        </div>

        {!isOwner && (
          <Button
            type="button"
            size="sm"
            variant={viewerIsSubscribed ? "secondary" : "default"}
            disabled={subscribeMutation.isPending}
            onClick={() => subscribeMutation.mutate(!viewerIsSubscribed)}
            className="rounded-full"
          >
            {viewerIsSubscribed ? "Subscribed" : "Subscribe"}
          </Button>
        )}
      </div>

      {user.bio && (
        <p className="mt-4 max-w-2xl whitespace-pre-line text-sm text-foreground/80">{user.bio}</p>
      )}

      <div className="mt-8 border-b border-border">
        <nav className="-mb-px flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                tab === t.value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <span className="ml-2 text-xs text-muted-foreground">{t.count}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {tab === "videos" ? (
          videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No videos yet.</p>
          ) : (
            <VideoGrid
              videos={videos.map((v) => ({
                id: v.id,
                title: v.title,
                thumbnailUrl: abs(v.thumbnailUrl),
                duration: v.duration,
                viewCount: v.viewCount,
                createdAt: v.createdAt,
                user: { name: v.user.name, image: abs(v.user.image) },
              }))}
            />
          )
        ) : playlistsQuery.isLoading ? (
          <Loader />
        ) : (playlistsQuery.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No playlists yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(playlistsQuery.data?.items ?? []).map((p) => (
              <PlaylistCard key={p.id} playlist={p} showVisibility />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
