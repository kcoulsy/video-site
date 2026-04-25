import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

import { CommentItem } from "./comment-item";
import type { CommentsPage } from "./types";

interface CommentListProps {
  videoId: string;
  sort: "newest" | "oldest";
  currentUserId?: string;
}

export function CommentList({
  videoId,
  sort,
  currentUserId,
}: CommentListProps) {
  const query = useInfiniteQuery<CommentsPage>({
    queryKey: ["comments", videoId, "top", sort],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("sort", sort);
      if (pageParam) params.set("cursor", String(pageParam));
      return apiClient<CommentsPage>(
        `/api/videos/${videoId}/comments?${params.toString()}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-secondary" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 animate-pulse rounded bg-secondary" />
              <div className="h-4 w-full animate-pulse rounded bg-secondary" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-secondary" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (query.error) {
    return (
      <p className="text-sm text-muted-foreground">Failed to load comments.</p>
    );
  }

  const comments = query.data?.pages.flatMap((p) => p.comments) ?? [];

  if (comments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No comments yet. Be the first to comment.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          videoId={videoId}
          currentUserId={currentUserId}
        />
      ))}
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="self-start rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {query.isFetchingNextPage ? "Loading..." : "Load more comments"}
        </button>
      )}
    </div>
  );
}
