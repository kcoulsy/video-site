import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ListVideo, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";

import Loader from "@/components/loader";
import { PlaylistCard } from "@/components/playlist-card";
import { getUser } from "@/functions/get-user";
import { apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/playlists/mine")({
  component: MyPlaylistsPage,
  head: () => ({ meta: [{ title: "Your Playlists — Watchbox" }] }),
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

function MyPlaylistsPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const { data, isLoading } = useQuery<{ items: PlaylistRow[] }>({
    queryKey: ["playlists", "mine"],
    queryFn: () => apiClient<{ items: PlaylistRow[] }>("/api/playlists/mine"),
  });

  const createPlaylist = useMutation({
    mutationFn: async () =>
      apiClient<{ id: string }>("/api/playlists", {
        method: "POST",
        body: JSON.stringify({ title: newTitle.trim(), visibility: "private" }),
      }),
    onSuccess: () => {
      setCreating(false);
      setNewTitle("");
      queryClient.invalidateQueries({ queryKey: ["playlists", "mine"] });
      toast.success("Playlist created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create playlist");
    },
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
      <div className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ListVideo className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Your Playlists</h1>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New playlist
          </Button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newTitle.trim()) createPlaylist.mutate();
          }}
          className="mb-6 flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center"
        >
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Playlist title"
            maxLength={120}
            className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setNewTitle("");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!newTitle.trim() || createPlaylist.isPending}>
              Create
            </Button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <ListVideo className="h-12 w-12 text-muted-foreground/30" />
          <p className="mt-4 text-sm text-muted-foreground">
            You haven't created any playlists yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create one above, or save a video from any watch page.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((p) => (
            <PlaylistCard key={p.id} playlist={p} showVisibility />
          ))}
        </div>
      )}
    </div>
  );
}
