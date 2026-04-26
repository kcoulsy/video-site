import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ListVideo, Play, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import { env } from "@video-site/env/web";

import Loader from "@/components/loader";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDuration, formatViewCount, formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/playlist/$playlistId")({
  component: PlaylistDetailPage,
});

interface PlaylistItemRow {
  videoId: string;
  position: number;
  addedAt: string;
  video: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    duration: number | null;
    viewCount: number;
    createdAt: string;
    user: { id: string; name: string; image: string | null };
  };
}

interface PlaylistResponse {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "unlisted" | "private";
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  user: { id: string; name: string; image: string | null };
  items: PlaylistItemRow[];
}

function absoluteUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return `${env.VITE_SERVER_URL}${path}`;
}

function PlaylistDetailPage() {
  const { playlistId } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<"public" | "unlisted" | "private">(
    "private",
  );

  const { data, isLoading, error } = useQuery<PlaylistResponse>({
    queryKey: ["playlist", playlistId],
    queryFn: () => apiClient<PlaylistResponse>(`/api/playlists/${playlistId}`),
  });

  const removeMutation = useMutation({
    mutationFn: (videoId: string) =>
      apiClient(`/api/playlists/${playlistId}/items/${videoId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove");
    },
  });

  const reorderMutation = useMutation({
    mutationFn: ({ videoId, position }: { videoId: string; position: number }) =>
      apiClient(`/api/playlists/${playlistId}/items/${videoId}`, {
        method: "PATCH",
        body: JSON.stringify({ position }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to reorder");
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient(`/api/playlists/${playlistId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTitle,
          description: editDescription || null,
          visibility: editVisibility,
        }),
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlists", "mine"] });
      toast.success("Playlist updated");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to update");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient(`/api/playlists/${playlistId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Playlist deleted");
      queryClient.invalidateQueries({ queryKey: ["playlists", "mine"] });
      navigate({ to: "/playlists" });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    },
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
          {status === 404 ? "Playlist not found" : "Couldn't load playlist"}
        </h1>
      </div>
    );
  }

  const startEdit = () => {
    setEditTitle(data.title);
    setEditDescription(data.description ?? "");
    setEditVisibility(data.visibility);
    setEditing(true);
  };

  const items = data.items;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex h-48 w-full shrink-0 items-center justify-center bg-gradient-to-br from-secondary to-muted md:w-80">
          {items[0]?.video.thumbnailUrl ? (
            <img
              src={absoluteUrl(items[0].video.thumbnailUrl)}
              alt={data.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <ListVideo className="h-16 w-16 text-muted-foreground/30" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-3">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={120}
                className="rounded-md border border-border bg-transparent px-3 py-2 text-xl font-semibold"
              />
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={3}
                maxLength={2000}
                className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              />
              <select
                value={editVisibility}
                onChange={(e) =>
                  setEditVisibility(e.target.value as "public" | "unlisted" | "private")
                }
                className="w-fit rounded-md border border-border bg-transparent px-2 py-1 text-sm"
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => updateMutation.mutate()}
                  disabled={!editTitle.trim() || updateMutation.isPending}
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">{data.title}</h1>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                {data.visibility} &middot; {items.length} {items.length === 1 ? "video" : "videos"}{" "}
                &middot; by {data.user.name}
              </p>
              {data.description && (
                <p className="mt-3 whitespace-pre-line text-sm text-foreground/80">
                  {data.description}
                </p>
              )}
              {data.isOwner && (
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={startEdit}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-red-500"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (window.confirm("Delete this playlist?")) {
                        deleteMutation.mutate();
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Play className="h-12 w-12 text-muted-foreground/30" />
          <p className="mt-4 text-sm text-muted-foreground">No videos in this playlist yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it, idx) => {
            const thumbnail = absoluteUrl(it.video.thumbnailUrl);
            return (
              <div
                key={it.videoId}
                className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-secondary/50"
              >
                <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">
                  {idx + 1}
                </span>
                <Link
                  to="/watch/$videoId"
                  params={{ videoId: it.videoId }}
                  className="flex min-w-0 flex-1 items-center gap-4"
                >
                  <div className="relative aspect-video w-40 shrink-0 overflow-hidden bg-secondary">
                    {thumbnail ? (
                      <img
                        src={thumbnail}
                        alt={it.video.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
                        <Play className="h-6 w-6 text-muted-foreground/30" />
                      </div>
                    )}
                    {it.video.duration != null && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
                        {formatDuration(it.video.duration)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">
                      {it.video.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{it.video.user.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatViewCount(it.video.viewCount)} views &middot;{" "}
                      {formatRelativeTime(it.video.createdAt)}
                    </p>
                  </div>
                </Link>
                {data.isOwner && (
                  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={idx === 0 || reorderMutation.isPending}
                      onClick={() =>
                        reorderMutation.mutate({ videoId: it.videoId, position: idx - 1 })
                      }
                      className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={idx === items.length - 1 || reorderMutation.isPending}
                      onClick={() =>
                        reorderMutation.mutate({ videoId: it.videoId, position: idx + 1 })
                      }
                      className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(it.videoId)}
                      className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
