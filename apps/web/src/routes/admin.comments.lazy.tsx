import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { EyeOff, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import { Input } from "@video-site/ui/components/input";

import { ApiError, apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";

export const Route = createLazyFileRoute("/admin/comments")({
  component: AdminComments,
});

interface AdminCommentRow {
  id: string;
  content: string;
  createdAt: string;
  deletedAt: string | null;
  removedBy: string | null;
  removalReason: string | null;
  videoId: string;
  videoTitle: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
}

interface CommentsResponse {
  items: AdminCommentRow[];
  page: number;
  limit: number;
  total: number;
}

const PAGE_SIZE = 25;

function AdminComments() {
  const queryClient = useQueryClient();
  const { session } = Route.useRouteContext() as { session: { user: { role?: string } } };
  const isAdmin = session?.user?.role === "admin";
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (q) params.set("q", q);

  const { data, isLoading } = useQuery<CommentsResponse>({
    queryKey: ["admin", "comments", page, q],
    queryFn: () => apiClient<CommentsResponse>(`/api/admin/comments?${params}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "comments"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
  };
  const onErr = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : "Action failed");

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient(`/api/admin/comments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Comment permanently deleted");
      invalidate();
    },
    onError: onErr,
  });

  const removeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient(`/api/moderation/comments/${id}/remove`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      toast.success("Comment removed");
      invalidate();
    },
    onError: onErr,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/api/moderation/comments/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Comment restored");
      invalidate();
    },
    onError: onErr,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Comments</h1>
      <p className="mt-1 text-sm text-muted-foreground">{total} total</p>

      <div className="mt-4">
        <Input
          placeholder="Search comment text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
            No comments match
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((c) => {
              const isRemoved = !!c.removedBy;
              return (
                <div
                  key={c.id}
                  className="flex gap-4 px-4 py-3 transition-colors hover:bg-secondary/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {isRemoved ? (
                        <span
                          className="italic text-muted-foreground"
                          title={c.removalReason ?? ""}
                        >
                          [removed] {c.content}
                        </span>
                      ) : c.deletedAt ? (
                        <span className="italic text-muted-foreground">[deleted] {c.content}</span>
                      ) : (
                        c.content
                      )}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        by <span className="text-foreground">{c.authorName}</span> ({c.authorEmail})
                      </span>
                      <span>{formatRelativeTime(c.createdAt)}</span>
                      <Link
                        to="/watch/$videoId"
                        params={{ videoId: c.videoId }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        on "{c.videoTitle}"
                      </Link>
                    </div>
                  </div>
                  <div className="flex items-start gap-1">
                    {isRemoved ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => restoreMutation.mutate(c.id)}
                        title="Restore"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const reason = prompt("Remove this comment? Enter a reason:");
                          if (!reason) return;
                          removeMutation.mutate({ id: c.id, reason });
                        }}
                        title="Remove"
                      >
                        <EyeOff className="h-4 w-4" />
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (
                            confirm(
                              "Permanently delete this comment? This cannot be undone. Use only for harmful content.",
                            )
                          ) {
                            deleteMutation.mutate(c.id);
                          }
                        }}
                        title="Hard delete"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
