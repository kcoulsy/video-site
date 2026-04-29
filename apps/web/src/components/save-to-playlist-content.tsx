import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";

import { apiClient } from "@/lib/api-client";

interface ContainsItem {
  id: string;
  title: string;
  visibility: "public" | "unlisted" | "private";
  contains: boolean;
}

interface Props {
  videoId: string;
}

export const containsKey = (videoId: string) => ["playlists-contains", videoId] as const;

export function SaveToPlaylistContent({ videoId }: Props) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const { data, refetch } = useQuery<{ items: ContainsItem[] }>({
    queryKey: containsKey(videoId),
    queryFn: () => apiClient<{ items: ContainsItem[] }>(`/api/playlists/contains/${videoId}`),
    staleTime: 15_000,
  });

  const toggleItem = useMutation({
    mutationFn: async ({ playlistId, contains }: { playlistId: string; contains: boolean }) => {
      if (contains) {
        await apiClient(`/api/playlists/${playlistId}/items/${videoId}`, { method: "DELETE" });
      } else {
        await apiClient(`/api/playlists/${playlistId}/items`, {
          method: "POST",
          body: JSON.stringify({ videoId }),
        });
      }
    },
    onMutate: async ({ playlistId, contains }) => {
      await queryClient.cancelQueries({ queryKey: containsKey(videoId) });
      const prev = queryClient.getQueryData<{ items: ContainsItem[] }>(containsKey(videoId));
      queryClient.setQueryData<{ items: ContainsItem[] }>(containsKey(videoId), (old) =>
        old
          ? {
              items: old.items.map((it) =>
                it.id === playlistId ? { ...it, contains: !contains } : it,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(containsKey(videoId), ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed to update playlist");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists", "mine"] });
    },
  });

  const createPlaylist = useMutation({
    mutationFn: async () => {
      const created = await apiClient<{ id: string }>(`/api/playlists`, {
        method: "POST",
        body: JSON.stringify({ title: newTitle, visibility: "private" }),
      });
      await apiClient(`/api/playlists/${created.id}/items`, {
        method: "POST",
        body: JSON.stringify({ videoId }),
      });
      return created;
    },
    onSuccess: () => {
      setCreating(false);
      setNewTitle("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["playlists", "mine"] });
      toast.success("Playlist created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create playlist");
    },
  });

  return (
    <div>
      <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Save to playlist
      </div>
      <div className="max-h-60 overflow-y-auto py-1">
        {(data?.items ?? []).length === 0 && !creating && (
          <p className="px-2 py-2 text-xs text-muted-foreground">No playlists yet.</p>
        )}
        {(data?.items ?? []).map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => toggleItem.mutate({ playlistId: it.id, contains: it.contains })}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                it.contains
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border"
              }`}
            >
              {it.contains && <Check className="h-3 w-3" />}
            </span>
            <span className="flex-1 truncate">{it.title}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{it.visibility}</span>
          </button>
        ))}
      </div>
      <div className="mt-1 border-t border-border pt-2">
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newTitle.trim()) createPlaylist.mutate();
            }}
            className="flex flex-col gap-2 p-1"
          >
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Playlist title"
              maxLength={120}
              className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2">
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
              <Button
                type="submit"
                size="sm"
                disabled={!newTitle.trim() || createPlaylist.isPending}
              >
                Create
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <Plus className="h-4 w-4" />
            New playlist
          </button>
        )}
      </div>
    </div>
  );
}
