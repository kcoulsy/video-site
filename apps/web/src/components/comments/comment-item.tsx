import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@video-site/ui/components/button";
import { ChevronDown, ChevronUp, Heart, Pin, ThumbsUp } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";

import { ReportButton } from "../report-button";
import { CommentForm } from "./comment-form";
import type { Comment, CommentsPage } from "./types";

interface CommentItemProps {
  comment: Comment;
  videoId: string;
  videoOwnerId: string;
  currentUserId?: string;
  isReply?: boolean;
}

const MENTION_RE = /(@[a-zA-Z0-9_]{3,30})/g;

function renderMentions(content: string) {
  const parts = content.split(MENTION_RE);
  return parts.map((part, i) => {
    if (part.startsWith("@") && part.length >= 4) {
      const handle = part.slice(1).toLowerCase();
      return (
        <Link key={i} to="/u/$handle" params={{ handle }} className="text-primary hover:underline">
          {part}
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function CommentItem({
  comment,
  videoId,
  videoOwnerId,
  currentUserId,
  isReply = false,
}: CommentItemProps) {
  const queryClient = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showReplies, setShowReplies] = useState(false);

  const isOwner = currentUserId === comment.user.id;
  const isVideoOwner = currentUserId === videoOwnerId;
  const isDeleted = comment.deletedAt != null;
  const isPinned = comment.pinnedAt != null;
  const isHearted = comment.creatorHeartedAt != null;

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
    enabled: !isReply && showReplies,
  });

  const threadRootId = comment.rootId ?? comment.id;

  const replyMutation = useMutation({
    mutationFn: (content: string) =>
      apiClient<Comment>(`/api/videos/${videoId}/comments/${comment.id}/replies`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (created) => {
      setReplying(false);
      if (!isReply) setShowReplies(true);
      queryClient.setQueryData<{
        pages: CommentsPage[];
        pageParams: unknown[];
      }>(["comments", videoId, "replies", threadRootId], (old) => {
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
              cm.id === threadRootId ? { ...cm, replyCount: cm.replyCount + 1 } : cm,
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
      apiClient<{ ok: true; editedAt: string }>(`/api/comments/${comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (data, content) => {
      setEditing(false);
      const updateInList = (cm: Comment) =>
        cm.id === comment.id ? { ...cm, content, editedAt: data.editedAt } : cm;
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
      if (isReply) {
        queryClient.setQueryData<{
          pages: CommentsPage[];
          pageParams: unknown[];
        }>(["comments", videoId, "replies", threadRootId], (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              comments: p.comments.map(updateInList),
            })),
          };
        });
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save edit");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient(`/api/comments/${comment.id}`, { method: "DELETE" }),
    onSuccess: () => {
      const removeFromList = (cm: Comment) => cm.id !== comment.id;
      const markDeleted = (cm: Comment) =>
        cm.id === comment.id
          ? { ...cm, content: "[deleted]", deletedAt: new Date().toISOString() }
          : cm;
      const transform = comment.replyCount > 0 ? markDeleted : null;

      const updatePages = (old: { pages: CommentsPage[]; pageParams: unknown[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            comments: transform ? p.comments.map(transform) : p.comments.filter(removeFromList),
          })),
        };
      };

      queryClient.setQueryData(["comments", videoId, "top"], updatePages);
      if (isReply) {
        queryClient.setQueryData(["comments", videoId, "replies", threadRootId], updatePages);
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
                  cm.id === threadRootId
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

  const updateCommentInCache = (patch: Partial<Comment>) => {
    const apply = (cm: Comment) => (cm.id === comment.id ? { ...cm, ...patch } : cm);
    const updatePages = (old: { pages: CommentsPage[]; pageParams: unknown[] } | undefined) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((p) => ({ ...p, comments: p.comments.map(apply) })),
      };
    };
    queryClient.setQueriesData({ queryKey: ["comments", videoId, "top"] }, updatePages);
    queryClient.setQueryData(["comments", videoId, "replies", threadRootId], updatePages);
  };

  const pinMutation = useMutation({
    mutationFn: () =>
      apiClient<{ pinnedAt: string | null }>(`/api/comments/${comment.id}/pin`, {
        method: isPinned ? "DELETE" : "POST",
      }),
    onSuccess: (data) => {
      updateCommentInCache({ pinnedAt: data.pinnedAt });
      if (!isPinned) {
        queryClient.invalidateQueries({ queryKey: ["comments", videoId, "top"] });
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update pin"),
  });

  const heartMutation = useMutation({
    mutationFn: () =>
      apiClient<{ creatorHeartedAt: string | null }>(`/api/comments/${comment.id}/heart`, {
        method: isHearted ? "DELETE" : "POST",
      }),
    onSuccess: (data) => updateCommentInCache({ creatorHeartedAt: data.creatorHeartedAt }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update heart"),
  });

  const likeMutation = useMutation({
    mutationFn: () =>
      apiClient<{ liked: boolean; likeCount: number }>(`/api/comments/${comment.id}/like`, {
        method: "POST",
      }),
    onMutate: async () => {
      const nextLiked = !comment.liked;
      const delta = nextLiked ? 1 : -1;
      const updateInList = (cm: Comment) =>
        cm.id === comment.id
          ? { ...cm, liked: nextLiked, likeCount: Math.max(0, cm.likeCount + delta) }
          : cm;
      const updatePages = (old: { pages: CommentsPage[]; pageParams: unknown[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            comments: p.comments.map(updateInList),
          })),
        };
      };
      queryClient.setQueriesData({ queryKey: ["comments", videoId, "top"] }, updatePages);
      queryClient.setQueryData(["comments", videoId, "replies", threadRootId], updatePages);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to like comment");
      queryClient.invalidateQueries({ queryKey: ["comments", videoId] });
    },
  });

  const handleDelete = () => {
    if (!confirm("Delete this comment?")) return;
    deleteMutation.mutate();
  };

  const replyPages = repliesQuery.data?.pages ?? [];
  const allReplies = replyPages.flatMap((p) => p.comments);

  const avatarInner = comment.user.image ? (
    <img src={comment.user.image} alt={comment.user.name} className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
      {comment.user.name.charAt(0).toUpperCase()}
    </div>
  );

  return (
    <div className="flex gap-3">
      {comment.user.handle ? (
        <Link
          to="/u/$handle"
          params={{ handle: comment.user.handle }}
          className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-secondary"
        >
          {avatarInner}
        </Link>
      ) : (
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-secondary">
          {avatarInner}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {isPinned && !isReply && (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Pin className="h-3 w-3" />
            Pinned by creator
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          {comment.user.handle ? (
            <Link
              to="/u/$handle"
              params={{ handle: comment.user.handle }}
              className="font-semibold transition-colors hover:text-primary"
            >
              {comment.user.name}
            </Link>
          ) : (
            <span className="font-semibold">{comment.user.name}</span>
          )}
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
            {isDeleted ? comment.content : renderMentions(comment.content)}
          </p>
        )}

        {!editing && !isDeleted && (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (!currentUserId) {
                  toast.message("Sign in to like comments");
                  return;
                }
                likeMutation.mutate();
              }}
              disabled={likeMutation.isPending}
              aria-pressed={comment.liked}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-70 ${
                comment.liked ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ThumbsUp className={`h-3.5 w-3.5 ${comment.liked ? "fill-primary" : ""}`} />
              {comment.likeCount > 0 ? comment.likeCount : ""}
            </button>
            {isHearted && (
              <span
                aria-label="Creator hearted this"
                className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-500"
              >
                <Heart className="h-3 w-3 fill-red-500" />
              </span>
            )}
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
            {isVideoOwner && !isReply && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => pinMutation.mutate()}
                disabled={pinMutation.isPending}
                className="h-7 rounded-full px-2 text-xs"
              >
                <Pin className={`mr-1 h-3.5 w-3.5 ${isPinned ? "fill-primary" : ""}`} />
                {isPinned ? "Unpin" : "Pin"}
              </Button>
            )}
            {isVideoOwner && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => heartMutation.mutate()}
                disabled={heartMutation.isPending}
                className="h-7 rounded-full px-2 text-xs"
              >
                <Heart
                  className={`mr-1 h-3.5 w-3.5 ${isHearted ? "fill-red-500 text-red-500" : ""}`}
                />
                {isHearted ? "Unheart" : "Heart"}
              </Button>
            )}
            {!isOwner && currentUserId && (
              <ReportButton
                targetType="comment"
                targetId={comment.id}
                isAuthenticated
                variant="icon"
              />
            )}
          </div>
        )}

        {replying && (
          <div className="mt-3">
            <CommentForm
              autoFocus
              placeholder={`Reply to ${comment.user.name}...`}
              submitLabel="Reply"
              initialContent={isReply && comment.user.handle ? `@${comment.user.handle} ` : ""}
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
            {showReplies ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
                videoOwnerId={videoOwnerId}
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
                {repliesQuery.isFetchingNextPage ? "Loading..." : "Show more replies"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
