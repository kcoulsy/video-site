import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { ListVideo, Play } from "lucide-react";
import { env } from "@video-site/env/web";

import Loader from "@/components/loader";
import { getUser } from "@/functions/get-user";
import { apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/playlists")({
  component: PlaylistsPage,
  head: () => ({ meta: [{ title: "Playlists — Watchbox" }] }),
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

interface PlaylistRow {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "unlisted" | "private";
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  thumbnailUrl: string | null;
}

function absoluteUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return `${env.VITE_SERVER_URL}${path}`;
}

function PlaylistsPage() {
  const { data, isLoading } = useQuery<{ items: PlaylistRow[] }>({
    queryKey: ["playlists", "mine"],
    queryFn: () => apiClient<{ items: PlaylistRow[] }>("/api/playlists/mine"),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader />
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-8 flex items-center gap-3">
        <ListVideo className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Your Playlists</h1>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <ListVideo className="h-12 w-12 text-muted-foreground/30" />
          <p className="mt-4 text-sm text-muted-foreground">
            You haven't created any playlists yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Save a video to a new playlist from any watch page.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((p) => {
            const thumbnail = absoluteUrl(p.thumbnailUrl);
            return (
              <Link
                key={p.id}
                to="/playlist/$playlistId"
                params={{ playlistId: p.id }}
                className="group block"
              >
                <div className="relative aspect-video overflow-hidden bg-secondary">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={p.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
                      <ListVideo className="h-10 w-10 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">
                    <Play className="h-3 w-3" />
                    {p.itemCount}
                  </div>
                </div>
                <div className="mt-2">
                  <h3 className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">
                    {p.title}
                  </h3>
                  <p className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                    {p.visibility} &middot; updated {formatRelativeTime(p.updatedAt)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
