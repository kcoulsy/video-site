import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";

import { apiClient } from "@/lib/api-client";

interface WatchLaterButtonProps {
  videoId: string;
  isAuthenticated: boolean;
}

const statusKey = (videoId: string) => ["watch-later-status", videoId] as const;

export function WatchLaterButton({ videoId, isAuthenticated }: WatchLaterButtonProps) {
  const queryClient = useQueryClient();

  const { data } = useQuery<{ saved: boolean }>({
    queryKey: statusKey(videoId),
    queryFn: () => apiClient<{ saved: boolean }>(`/api/watch-later/${videoId}/status`),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const saved = data?.saved ?? false;

  const mutate = useMutation({
    mutationFn: () =>
      apiClient<{ saved: boolean }>(`/api/watch-later/${videoId}`, {
        method: saved ? "DELETE" : "POST",
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: statusKey(videoId) });
      const prev = queryClient.getQueryData<{ saved: boolean }>(statusKey(videoId));
      queryClient.setQueryData(statusKey(videoId), { saved: !saved });
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(statusKey(videoId), ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed to update Watch Later");
    },
    onSuccess: (res) => {
      queryClient.setQueryData(statusKey(videoId), res);
      queryClient.invalidateQueries({ queryKey: ["watch-later"] });
      toast.success(res.saved ? "Saved to Watch Later" : "Removed from Watch Later");
    },
  });

  const handleClick = () => {
    if (!isAuthenticated) {
      toast.message("Sign in to save videos");
      return;
    }
    mutate.mutate();
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      className="gap-1.5 rounded-full"
      onClick={handleClick}
      disabled={mutate.isPending}
      aria-pressed={saved}
    >
      {saved ? (
        <BookmarkCheck className="h-4 w-4 fill-primary text-primary" />
      ) : (
        <Bookmark className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">{saved ? "Saved" : "Save"}</span>
    </Button>
  );
}
