import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api-client";
import { formatViewCount } from "@/lib/format";

type LikeType = "like" | "dislike" | null;

interface LikeStateResponse {
  type: LikeType;
}

interface LikeButtonProps {
  videoId: string;
  likeCount: number;
  dislikeCount: number;
  isAuthenticated: boolean;
}

interface VideoCounts {
  likeCount: number;
  dislikeCount: number;
}

const likeStateKey = (videoId: string) => ["like-state", videoId] as const;
const videoKey = (videoId: string) => ["video", videoId] as const;

function applyToggle(current: LikeType, action: "like" | "dislike"): LikeType {
  if (current === action) return null;
  return action;
}

function deltaCounts(prev: LikeType, next: LikeType): { like: number; dislike: number } {
  let like = 0;
  let dislike = 0;
  if (prev === "like") like -= 1;
  if (prev === "dislike") dislike -= 1;
  if (next === "like") like += 1;
  if (next === "dislike") dislike += 1;
  return { like, dislike };
}

export function LikeButton({ videoId, likeCount, dislikeCount, isAuthenticated }: LikeButtonProps) {
  const queryClient = useQueryClient();

  const { data: likeState } = useQuery<LikeStateResponse>({
    queryKey: likeStateKey(videoId),
    queryFn: () => apiClient<LikeStateResponse>(`/api/videos/${videoId}/like`),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const currentType: LikeType = likeState?.type ?? null;

  const mutate = useMutation({
    mutationFn: (action: "like" | "dislike") =>
      apiClient<LikeStateResponse>(`/api/videos/${videoId}/${action}`, {
        method: "POST",
      }),
    onMutate: async (action) => {
      await queryClient.cancelQueries({ queryKey: likeStateKey(videoId) });
      await queryClient.cancelQueries({ queryKey: videoKey(videoId) });

      const prevState = queryClient.getQueryData<LikeStateResponse>(likeStateKey(videoId)) ?? {
        type: null,
      };
      const prevVideo = queryClient.getQueryData<VideoCounts & Record<string, unknown>>(
        videoKey(videoId),
      );

      const nextType = applyToggle(prevState.type, action);
      const delta = deltaCounts(prevState.type, nextType);

      queryClient.setQueryData<LikeStateResponse>(likeStateKey(videoId), {
        type: nextType,
      });
      if (prevVideo) {
        queryClient.setQueryData(videoKey(videoId), {
          ...prevVideo,
          likeCount: Math.max(0, (prevVideo.likeCount ?? 0) + delta.like),
          dislikeCount: Math.max(0, (prevVideo.dislikeCount ?? 0) + delta.dislike),
        });
      }

      return { prevState, prevVideo };
    },
    onError: (err, _action, ctx) => {
      if (ctx?.prevState) {
        queryClient.setQueryData(likeStateKey(videoId), ctx.prevState);
      }
      if (ctx?.prevVideo) {
        queryClient.setQueryData(videoKey(videoId), ctx.prevVideo);
      }
      toast.error(err instanceof Error ? err.message : "Failed to update reaction");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: likeStateKey(videoId) });
      queryClient.invalidateQueries({ queryKey: videoKey(videoId) });
    },
  });

  const handleClick = (action: "like" | "dislike") => {
    if (!isAuthenticated) {
      toast.message("Sign in to react to this video");
      return;
    }
    mutate.mutate(action);
  };

  const displayLikes = likeCount;
  const displayDislikes = dislikeCount;

  return (
    <div className="flex items-center overflow-hidden rounded-full bg-secondary">
      <button
        onClick={() => handleClick("like")}
        disabled={mutate.isPending}
        aria-pressed={currentType === "like"}
        className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-70 ${
          currentType === "like" ? "text-primary" : "text-foreground hover:bg-accent"
        }`}
      >
        <ThumbsUp className={`h-4 w-4 ${currentType === "like" ? "fill-primary" : ""}`} />
        {formatViewCount(displayLikes)}
      </button>
      <div className="h-6 w-px bg-border" />
      <button
        onClick={() => handleClick("dislike")}
        disabled={mutate.isPending}
        aria-pressed={currentType === "dislike"}
        className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-70 ${
          currentType === "dislike" ? "text-foreground" : "text-foreground hover:bg-accent"
        }`}
      >
        <ThumbsDown className={`h-4 w-4 ${currentType === "dislike" ? "fill-foreground" : ""}`} />
        {displayDislikes > 0 ? formatViewCount(displayDislikes) : null}
      </button>
    </div>
  );
}
