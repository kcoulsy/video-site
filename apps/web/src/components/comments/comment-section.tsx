import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { apiClient } from "@/lib/api-client";

import { CommentForm } from "./comment-form";
import { CommentList } from "./comment-list";
import type { Comment, CommentsPage } from "./types";

interface CommentSectionProps {
  videoId: string;
  videoOwnerId: string;
  commentCount: number;
}

export function CommentSection({ videoId, videoOwnerId, commentCount }: CommentSectionProps) {
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const { data: session } = authClient.useSession();
  const currentUser = session?.user;
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (content: string) =>
      apiClient<Comment>(`/api/videos/${videoId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<{
        pages: CommentsPage[];
        pageParams: unknown[];
      }>(["comments", videoId, "top", sort], (old) => {
        if (!old) {
          return {
            pages: [{ comments: [created], nextCursor: null, hasMore: false }],
            pageParams: [null],
          };
        }
        const [first, ...rest] = old.pages;
        return {
          ...old,
          pages: [
            {
              ...first,
              comments:
                sort === "newest"
                  ? [created, ...(first?.comments ?? [])]
                  : [...(first?.comments ?? []), created],
            } as CommentsPage,
            ...rest,
          ],
        };
      });
      queryClient.setQueryData<{ commentCount: number } & Record<string, unknown>>(
        ["video", videoId],
        (old) => (old ? { ...old, commentCount: (old.commentCount ?? 0) + 1 } : old),
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to post comment");
    },
  });

  return (
    <div className="mb-12 mt-6">
      <div className="mb-4 flex items-center gap-3">
        <MessageSquare className="h-5 w-5" />
        <h2 className="text-lg font-semibold">{commentCount} Comments</h2>
        <div className="ml-auto">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      {currentUser ? (
        <div className="mb-6 flex gap-3">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-secondary">
            {currentUser.image ? (
              <img
                src={currentUser.image}
                alt={currentUser.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1">
            <CommentForm onSubmit={(content) => createMutation.mutateAsync(content)} />
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>{" "}
          to comment.
        </div>
      )}

      <CommentList
        videoId={videoId}
        videoOwnerId={videoOwnerId}
        sort={sort}
        currentUserId={currentUser?.id}
      />
    </div>
  );
}
