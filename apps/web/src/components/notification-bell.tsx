import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { Button } from "@video-site/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";

import { authClient } from "@/lib/auth-client";
import { apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";

interface NotificationActor {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
}

type NotificationKind = "new_upload" | "comment_reply" | "video_like" | "comment_like" | "mention";

interface NotificationItem {
  id: string;
  kind: NotificationKind;
  readAt: string | null;
  createdAt: string;
  videoId: string | null;
  commentId: string | null;
  actor: NotificationActor | null;
  videoTitle: string | null;
  commentSnippet: string | null;
}

interface ListResponse {
  items: NotificationItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface CountResponse {
  count: number;
}

function describeKind(n: NotificationItem): string {
  const who = n.actor?.name ?? "Someone";
  switch (n.kind) {
    case "new_upload":
      return `${who} uploaded a new video`;
    case "comment_reply":
      return `${who} replied to your comment`;
    case "video_like":
      return `${who} liked your video`;
    case "comment_like":
      return `${who} liked your comment`;
    case "mention":
      return `${who} mentioned you`;
  }
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  const countQuery = useQuery<CountResponse>({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiClient<CountResponse>("/api/notifications/unread-count"),
    enabled: !!session,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const listQuery = useQuery<ListResponse>({
    queryKey: ["notifications", "list"],
    queryFn: () => apiClient<ListResponse>("/api/notifications?limit=15"),
    enabled: false,
  });

  const markReadMutation = useMutation({
    mutationFn: (ids: string[] | "all") =>
      apiClient<{ ok: true }>("/api/notifications/read", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      queryClient.setQueryData<CountResponse>(["notifications", "unread-count"], { count: 0 });
    },
  });

  if (!session) return null;

  const count = countQuery.data?.count ?? 0;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          listQuery.refetch().then((res) => {
            const unread = (res.data?.items ?? []).filter((n) => !n.readAt).map((n) => n.id);
            if (unread.length > 0) markReadMutation.mutate(unread);
          });
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" aria-label="Notifications" className="relative" />
        }
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 bg-card p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {count > 0 && (
            <button
              type="button"
              onClick={() => markReadMutation.mutate("all")}
              className="text-xs text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {listQuery.isLoading ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : (listQuery.data?.items ?? []).length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            (listQuery.data?.items ?? []).map((n) => {
              const summary = describeKind(n);
              const linkTarget = n.videoId ? `/watch/${n.videoId}` : null;
              const inner = (
                <div
                  className={`flex items-start gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 ${
                    n.readAt ? "opacity-70" : "bg-accent/30"
                  }`}
                >
                  {n.actor?.image ? (
                    <img
                      src={n.actor.image}
                      alt={n.actor.name}
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                      {(n.actor?.name ?? "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">{summary}</p>
                    {n.videoTitle && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {n.videoTitle}
                      </p>
                    )}
                    {n.commentSnippet && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {n.commentSnippet}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {formatRelativeTime(n.createdAt)}
                    </p>
                  </div>
                </div>
              );
              return linkTarget ? (
                <Link key={n.id} to={linkTarget} className="block">
                  {inner}
                </Link>
              ) : (
                <div key={n.id}>{inner}</div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
