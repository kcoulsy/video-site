import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@video-site/ui/components/button";
import { ChevronDown, ChevronUp, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";

import { CommentForm } from "./comment-form";
import type { Comment, CommentsPage } from "./types";

interface CommentItemProps {
  comment: Comment;
  videoId: string;
  currentUserId?: string;
  isReply?: boolean;
}

export function CommentItem({
  comment,
  videoId,
  currentUserId,
  isReply = false,
}: CommentItemProps) {
  const queryClient = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showReplies, setShowReplies] = useState(false);

  const isOwner = currentUserId === comment.user.id;
  const isDeleted = comment.deletedAt != null;

  const repliesQuery = useInfiniteQuery<CommentsPage>({
    queryKey: ["comments", videoId, "replies", comment.id],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", String(pageParam));
      const qs = params.toString();
      return apiClient<CommentsPage>(
        `/api/videos/${videoId}/comments/${comment.id}/replies${qs ? `?${qs}` : ""}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: showReplies,
  });

  const replyMutation = useMutation({
    mutationFn: (content: string) =>
      apiClient<Comment>(
        `/api/videos/${videoId}/comments/${comment.id}/replies`,
        {
          method: "POST",
          body: JSON.stringify({ content }),
        },
      ),
    onSuccess: (created) => {
      setReplying(false);
      setShowReplies(true);
      queryClient.setQueryData<{
        pages: CommentsPage[];
        pageParams: unknown[];
      }>(["comments", videoId, "replies", comment.id], (old) => {
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
              comments: [...(first?.comments ?? []), created],
            } as CommentsPage,
            ...rest,
          ],
        };
      });
      queryClient.setQueryData<{
        pages: CommentsPage[];
        pageParams: unknown[];
      }>(["comments", videoId, "top"], (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            comments: p.comments.map((cm) =>
              cm.id === comment.id
                ? { ...cm, replyCount: cm.replyCount + 1 }
                : cm,
            ),
          })),
        };
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to post reply");
    },
  });

  const editMutation = useMutation({
    mutationFn: (content: string) =>
      apiClient<{ ok: true; editedAt: string }>(
        `/api/comments/${comment.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ content }),
        },
      ),
    onSuccess: (data, content) => {
      setEditing(false);
      const updateInList = (cm: Comment) =>
        cm.id === comment.id
          ? { ...cm, content, editedAt: data.editedAt }
          : cm;
      queryClient.setQueryData<{
        pages: CommentsPage[];
        pageParams: unknown[];
      }>(["comments", videoId, "top"], (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            comments: p.comments.map(updateInList),
          })),
        };
      });
      if (comment.parentId) {
        queryClient.setQueryData<{
          pages: CommentsPage[];
          pageParams: unknown[];
        }>(
          ["comments", videoId, "replies", comment.parentId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                comments: p.comments.map(updateInList),
              })),
            };
          },
        );
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save edit");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiClient(`/api/comments/${comment.id}`, { method: "DELETE" }),
    onSuccess: () => {
      const removeFromList = (cm: Comment) => cm.id !== comment.id;
      const markDeleted = (cm: Comment) =>
        cm.id === comment.id
          ? { ...cm, content: "[deleted]", deletedAt: new Date().toISOString() }
          : cm;
      const transform = comment.replyCount > 0 ? markDeleted : null;

      const updatePages = (
        old:
          | { pages: CommentsPage[]; pageParams: unknown[] }
          | undefined,
      ) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            comments: transform
              ? p.comments.map(transform)
              : p.comments.filter(removeFromList),
          })),
        };
      };

      queryClient.setQueryData(["comments", videoId, "top"], updatePages);
      if (comment.parentId) {
        queryClient.setQueryData(
          ["comments", videoId, "replies", comment.parentId],
          updatePages,
        );
        if (!transform) {
          queryClient.setQueryData<{
            pages: CommentsPage[];
            pageParams: unknown[];
          }>(["comments", videoId, "top"], (old) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                comments: p.comments.map((cm) =>
                  cm.id === comment.parentId
                    ? {
                        ...cm,
                        replyCount: Math.max(0, cm.replyCount - 1),
                      }
                    : cm,
                ),
              })),
            };
          });
        }
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    },
  });

  const handleDelete = () => {
    if (!confirm("Delete this comment?")) return;
    deleteMutation.mutate();
  };

  const replyPages = repliesQuery.data?.pages ?? [];
  const allReplies = replyPages.flatMap((p) => p.comments);

  return (
    <div className="flex gap-3">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-secondary">
        {comment.user.image ? (
          <img
            src={comment.user.image}
            alt={comment.user.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
            {comment.user.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">{comment.user.name}</span>
          <span className="text-muted-foreground">
            {formatRelativeTime(comment.createdAt)}
            {comment.editedAt && !isDeleted && " (edited)"}
          </span>
        </div>

        {editing ? (
          <div className="mt-2">
            <CommentForm
              initialContent={comment.content}
              autoFocus
              submitLabel="Save"
              onSubmit={(content) => editMutation.mutateAsync(content)}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <p
            className={`mt-1 whitespace-pre-wrap text-sm ${
              isDeleted ? "italic text-muted-foreground" : ""
            }`}
          >
            {comment.content}
          </p>
        )}

        {!editing && !isDeleted && (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              {comment.likeCount > 0 ? comment.likeCount : ""}
            </button>
            {currentUserId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReplying((v) => !v)}
                className="h-7 rounded-full px-2 text-xs"
              >
                Reply
              </Button>
            )}
            {isOwner && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                  className="h-7 rounded-full px-2 text-xs"
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="h-7 rounded-full px-2 text-xs text-red-500 hover:text-red-600"
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        )}

        {replying && (
          <div className="mt-3">
            <CommentForm
              autoFocus
              placeholder={`Reply to ${comment.user.name}...`}
              submitLabel="Reply"
              onSubmit={(content) => replyMutation.mutateAsync(content)}
              onCancel={() => setReplying(false)}
            />
          </div>
        )}

        {!isReply && comment.replyCount > 0 && (
          <button
            type="button"
            onClick={() => setShowReplies((v) => !v)}
            className="mt-3 flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            {showReplies ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {showReplies ? "Hide" : "View"} {comment.replyCount}{" "}
            {comment.replyCount === 1 ? "reply" : "replies"}
          </button>
        )}

        {showReplies && (
          <div className="mt-4 flex flex-col gap-4">
            {repliesQuery.isLoading && (
              <p className="text-xs text-muted-foreground">Loading replies...</p>
            )}
            {allReplies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                videoId={videoId}
                currentUserId={currentUserId}
                isReply
              />
            ))}
            {repliesQuery.hasNextPage && (
              <button
                type="button"
                onClick={() => repliesQuery.fetchNextPage()}
                disabled={repliesQuery.isFetchingNextPage}
                className="self-start text-xs font-medium text-primary hover:text-primary/80"
              >
                {repliesQuery.isFetchingNextPage
                  ? "Loading..."
                  : "Show more replies"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
