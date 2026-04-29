import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { Button } from "@video-site/ui/components/button";
import { Input } from "@video-site/ui/components/input";
import { Label } from "@video-site/ui/components/label";
import { ArrowLeft, Eye, EyeOff, Film, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getUser } from "@/functions/get-user";
import { ApiError, apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/videos/$videoId/edit")({
  component: EditVideoPage,
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

interface VideoDetailResponse {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "unlisted" | "private";
  tags: string[] | null;
  thumbnailUrl: string | null;
  userId: string;
  thumbnailStillsCount: number;
  thumbnailStillIndex: number | null;
}

interface TagOption {
  id: string;
  slug: string;
  name: string;
}

interface TagsResponse {
  items: TagOption[];
}

function EditVideoPage() {
  const { videoId } = Route.useParams();
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: video,
    isLoading: videoLoading,
    error: videoError,
  } = useQuery<VideoDetailResponse>({
    queryKey: ["video", videoId],
    queryFn: () => apiClient<VideoDetailResponse>(`/api/videos/${videoId}`),
  });

  const { data: tagData } = useQuery<TagsResponse>({
    queryKey: ["tags"],
    queryFn: () => apiClient<TagsResponse>("/api/tags"),
    staleTime: 5 * 60 * 1000,
  });
  const tagOptions = tagData?.items ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const isOwner = video && session?.user.id === video.userId;

  useEffect(() => {
    const previous = document.title;
    document.title = video?.title
      ? `Edit: ${video.title} — ${env.VITE_APP_NAME}`
      : `Edit video — ${env.VITE_APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [video?.title]);

  useEffect(() => {
    if (!video || !tagData || hydrated) return;
    setTitle(video.title);
    setDescription(video.description ?? "");
    setVisibility(video.visibility);
    const slugSet = new Set(video.tags ?? []);
    setSelectedTagIds(tagData.items.filter((t) => slugSet.has(t.slug)).map((t) => t.id));
    setHydrated(true);
  }, [video, tagData, hydrated]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient(`/api/videos/${videoId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          visibility,
          tagIds: selectedTagIds,
        }),
      }),
    onSuccess: () => {
      toast.success("Changes saved");
      void queryClient.invalidateQueries({ queryKey: ["videos", "my"] });
      void queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      void navigate({ to: "/dashboard" });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Failed to save changes";
      toast.error(msg);
    },
  });

  const [pendingStillIndex, setPendingStillIndex] = useState<number | null>(null);

  const selectThumbnailMutation = useMutation({
    mutationFn: (index: number) =>
      apiClient(`/api/videos/${videoId}/thumbnail/select`, {
        method: "POST",
        body: JSON.stringify({ index }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["video", videoId] });
      void queryClient.invalidateQueries({ queryKey: ["videos", "my"] });
      setPendingStillIndex(null);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Failed to update thumbnail";
      toast.error(msg);
      setPendingStillIndex(null);
    },
  });

  const activeStillIndex = pendingStillIndex ?? video?.thumbnailStillIndex ?? null;

  const isBusy = saveMutation.isPending;
  const canSubmit = useMemo(
    () => hydrated && title.trim().length > 0 && !isBusy,
    [hydrated, title, isBusy],
  );

  if (videoLoading || !tagData) {
    return (
      <div className="mx-auto flex max-w-2xl items-center justify-center px-4 py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (videoError || !video) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Video not found.</p>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm text-muted-foreground">
          You don't have permission to edit this video.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button
        type="button"
        onClick={() => navigate({ to: "/dashboard" })}
        disabled={isBusy}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Edit Video</h1>
        <p className="mt-1 text-sm text-muted-foreground">Update your video's details.</p>
      </div>

      {video.thumbnailStillsCount > 0 ? (
        <div className="mb-6 space-y-2">
          <Label>Thumbnail</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Array.from({ length: video.thumbnailStillsCount }).map((_, i) => {
              const isActive = activeStillIndex === i;
              const isPending = selectThumbnailMutation.isPending && pendingStillIndex === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    if (isActive || selectThumbnailMutation.isPending) return;
                    setPendingStillIndex(i);
                    selectThumbnailMutation.mutate(i);
                  }}
                  disabled={selectThumbnailMutation.isPending}
                  className={`relative aspect-video overflow-hidden rounded-md border-2 bg-secondary transition-all disabled:cursor-not-allowed ${
                    isActive
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <img
                    src={`${env.VITE_SERVER_URL}/api/stream/${videoId}/thumbnail/still/${i}`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {isPending ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Pick a frame to use as your video's thumbnail.
          </p>
        </div>
      ) : (
        <div className="mb-6 aspect-video w-full overflow-hidden rounded-lg border border-border bg-secondary">
          {video.thumbnailUrl ? (
            <img
              src={`${env.VITE_SERVER_URL}${video.thumbnailUrl}`}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
              <Film className="h-10 w-10 text-muted-foreground/30" />
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) saveMutation.mutate();
        }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give your video a title"
            disabled={isBusy}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-desc">Description</Label>
          <textarea
            id="edit-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell viewers about your video"
            rows={5}
            disabled={isBusy}
            className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
          />
        </div>

        <div className="space-y-2">
          <Label>Tags</Label>
          {tagOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tags available yet. An admin needs to create tags before they can be applied.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagOptions.map((t) => {
                const active = selectedTagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setSelectedTagIds((prev) =>
                        prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                      )
                    }
                    disabled={isBusy}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Visibility</Label>
          <div className="flex gap-2">
            {(["public", "unlisted", "private"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                disabled={isBusy}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm capitalize transition-colors disabled:opacity-50 ${
                  visibility === v
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-muted-foreground"
                }`}
              >
                {v === "private" ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/dashboard" })}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save changes
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
