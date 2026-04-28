import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { Check, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";

import { ApiError, apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";



export const Route = createLazyFileRoute("/admin/queue")({
  component: AdminQueue,
});

interface VideoQueueItem {
  type: "video";
  id: string;
  createdAt: string;
  authorId: string;
  authorName: string | null;
  title: string;
  visibility: string;
  status: string;
  thumbnailPath: string | null;
}

interface CommentQueueItem {
  type: "comment";
  id: string;
  createdAt: string;
  authorId: string;
  authorName: string | null;
  content: string;
  videoId: string;
  videoTitle: string | null;
}

type QueueItem = VideoQueueItem | CommentQueueItem;

interface QueueResponse {
  items: QueueItem[];
  page: number;
  limit: number;
  total: number;
}

const PAGE_SIZE = 25;

function AdminQueue() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [type, setType] = useState<"all" | "video" | "comment">("all");

  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
    type,
  });

  const { data, isLoading } = useQuery<QueueResponse>({
    queryKey: ["admin", "queue", page, type],
    queryFn: () => apiClient<QueueResponse>(`/api/moderation/queue?${params}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "queue"] });
  };
  const onErr = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : "Action failed");

  const approveVideo = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/api/moderation/videos/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Marked OK");
      invalidate();
    },
    onError: onErr,
  });

  const approveComment = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/api/moderation/comments/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Marked OK");
      invalidate();
    },
    onError: onErr,
  });

  const removeVideo = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient(`/api/moderation/videos/${id}/remove`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      toast.success("Video removed");
      invalidate();
    },
    onError: onErr,
  });

  const removeComment = useMutation({
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

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Moderation queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {total} unreviewed item{total === 1 ? "" : "s"}
      </p>

      <div className="mt-4 flex gap-2">
        {(["all", "video", "comment"] as const).map((t) => (
          <Button
            key={t}
            variant={type === t ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setType(t);
              setPage(1);
            }}
          >
            {t === "all" ? "All" : t === "video" ? "Videos" : "Comments"}
          </Button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
            Queue is clear
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <QueueRow
                key={`${item.type}:${item.id}`}
                item={item}
                onApprove={() =>
                  item.type === "video"
                    ? approveVideo.mutate(item.id)
                    : approveComment.mutate(item.id)
                }
                onRemove={(reason) =>
                  item.type === "video"
                    ? removeVideo.mutate({ id: item.id, reason })
                    : removeComment.mutate({ id: item.id, reason })
                }
              />
            ))}
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

function QueueRow({
  item,
  onApprove,
  onRemove,
}: {
  item: QueueItem;
  onApprove: () => void;
  onRemove: (reason: string) => void;
}) {
  return (
    <div className="flex gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
            {item.type}
          </span>
          {item.type === "video" ? (
            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-500">
              {item.status}
            </span>
          ) : null}
        </div>
        {item.type === "video" ? (
          <p className="mt-2 truncate text-sm font-medium">{item.title}</p>
        ) : (
          <p className="mt-2 line-clamp-3 text-sm whitespace-pre-wrap">{item.content}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            by <span className="text-foreground">{item.authorName ?? "deleted user"}</span>
          </span>
          <span>{formatRelativeTime(item.createdAt)}</span>
          {item.type === "video" ? (
            <Link
              to="/watch/$videoId"
              params={{ videoId: item.id }}
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              view video
            </Link>
          ) : (
            <Link
              to="/watch/$videoId"
              params={{ videoId: item.videoId }}
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {item.videoTitle ?? "view video"}
            </Link>
          )}
        </div>
      </div>
      <div className="flex items-start gap-1">
        <Button variant="ghost" size="sm" onClick={onApprove} title="Mark OK (remove from queue)">
          <Check className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const reason = prompt("Removal reason:");
            if (reason && reason.trim()) onRemove(reason.trim());
          }}
          title="Remove"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
