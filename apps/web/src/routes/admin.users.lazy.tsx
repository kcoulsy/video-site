import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import {
  Ban,
  Clock,
  Loader2,
  MicOff,
  MoreHorizontal,
  ShieldCheck,
  ShieldOff,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";
import { Input } from "@video-site/ui/components/input";

import { ApiError, apiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";



export const Route = createLazyFileRoute("/admin/users")({
  component: AdminUsers,
});

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  image: string | null;
  createdAt: string;
  videoCount: number;
  commentCount: number;
  bannedAt: string | null;
  banReason: string | null;
  suspendedUntil: string | null;
  suspendReason: string | null;
  mutedAt: string | null;
  muteReason: string | null;
}

interface UsersResponse {
  items: AdminUserRow[];
  page: number;
  limit: number;
  total: number;
}

const PAGE_SIZE = 25;

function AdminUsers() {
  const queryClient = useQueryClient();
  const { session } = Route.useRouteContext();
  const currentUserId = session?.user.id;
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (q) params.set("q", q);

  const { data, isLoading } = useQuery<UsersResponse>({
    queryKey: ["admin", "users", page, q],
    queryFn: () => apiClient<UsersResponse>(`/api/admin/users?${params}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
  };

  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : "Action failed");

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "user" | "moderator" | "admin" }) =>
      apiClient(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: (_, vars) => {
      toast.success(`Role set to ${vars.role}`);
      invalidate();
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient(`/api/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("User deleted");
      invalidate();
    },
    onError,
  });

  const modAction = useMutation({
    mutationFn: async ({
      id,
      action,
      body,
    }: {
      id: string;
      action: string;
      body?: Record<string, unknown>;
    }) =>
      apiClient(`/api/moderation/users/${id}/${action}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: (_, vars) => {
      toast.success(`${vars.action} succeeded`);
      invalidate();
    },
    onError,
  });

  const handleBan = (u: AdminUserRow) => {
    const reason = prompt(`Ban ${u.email}? Enter a reason:`);
    if (!reason) return;
    modAction.mutate({ id: u.id, action: "ban", body: { reason } });
  };

  const handleUnban = (u: AdminUserRow) => {
    if (!confirm(`Unban ${u.email}?`)) return;
    modAction.mutate({ id: u.id, action: "unban" });
  };

  const handleSuspend = (u: AdminUserRow) => {
    const days = prompt(`Suspend ${u.email} for how many days?`, "7");
    if (!days) return;
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Invalid number of days");
      return;
    }
    const reason = prompt("Reason for suspension:");
    if (!reason) return;
    const until = new Date(Date.now() + n * 86400 * 1000).toISOString();
    modAction.mutate({ id: u.id, action: "suspend", body: { until, reason } });
  };

  const handleUnsuspend = (u: AdminUserRow) => {
    if (!confirm(`Lift suspension on ${u.email}?`)) return;
    modAction.mutate({ id: u.id, action: "unsuspend" });
  };

  const handleMute = (u: AdminUserRow) => {
    const reason = prompt(`Mute ${u.email}? Enter a reason:`);
    if (!reason) return;
    modAction.mutate({ id: u.id, action: "mute", body: { reason } });
  };

  const handleUnmute = (u: AdminUserRow) => {
    if (!confirm(`Unmute ${u.email}?`)) return;
    modAction.mutate({ id: u.id, action: "unmute" });
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">{total} total</p>

      <div className="mt-4">
        <Input
          placeholder="Search name or email"
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
            No users match
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((u) => {
              const isSelf = u.id === currentUserId;
              const isUserAdmin = u.role === "admin";
              const isModerator = u.role === "moderator";
              const isBanned = !!u.bannedAt;
              const isSuspended =
                !!u.suspendedUntil && new Date(u.suspendedUntil).getTime() > Date.now();
              const isMuted = !!u.mutedAt;
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-secondary/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary">
                    {u.image ? (
                      <img src={u.image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <UserIcon className="h-5 w-5 text-muted-foreground/40" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-medium">{u.name}</h3>
                      {isUserAdmin && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                          Admin
                        </span>
                      )}
                      {isModerator && (
                        <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-500">
                          Moderator
                        </span>
                      )}
                      {isBanned && (
                        <span
                          title={u.banReason ?? ""}
                          className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-destructive"
                        >
                          Banned
                        </span>
                      )}
                      {isSuspended && (
                        <span
                          title={`${u.suspendReason ?? ""} until ${u.suspendedUntil}`}
                          className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-500"
                        >
                          Suspended
                        </span>
                      )}
                      {isMuted && (
                        <span
                          title={u.muteReason ?? ""}
                          className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                        >
                          Muted
                        </span>
                      )}
                      {isSelf && (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          You
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>

                  <div className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
                    <div className="text-right">
                      <p className="font-medium text-foreground">{u.videoCount}</p>
                      <p className="text-xs">videos</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">{u.commentCount}</p>
                      <p className="text-xs">comments</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">{formatDate(u.createdAt)}</p>
                      <p className="text-xs">joined</p>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-card">
                      {isBanned ? (
                        <DropdownMenuItem disabled={isSelf} onClick={() => handleUnban(u)}>
                          <Ban className="mr-2 h-4 w-4" />
                          Unban
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled={isSelf} onClick={() => handleBan(u)}>
                          <Ban className="mr-2 h-4 w-4" />
                          Ban
                        </DropdownMenuItem>
                      )}
                      {isSuspended ? (
                        <DropdownMenuItem disabled={isSelf} onClick={() => handleUnsuspend(u)}>
                          <Clock className="mr-2 h-4 w-4" />
                          Lift suspension
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled={isSelf} onClick={() => handleSuspend(u)}>
                          <Clock className="mr-2 h-4 w-4" />
                          Suspend
                        </DropdownMenuItem>
                      )}
                      {isMuted ? (
                        <DropdownMenuItem disabled={isSelf} onClick={() => handleUnmute(u)}>
                          <MicOff className="mr-2 h-4 w-4" />
                          Unmute
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled={isSelf} onClick={() => handleMute(u)}>
                          <MicOff className="mr-2 h-4 w-4" />
                          Mute
                        </DropdownMenuItem>
                      )}
                      {isAdmin && (
                        <>
                          {isUserAdmin ? (
                            <DropdownMenuItem
                              disabled={isSelf}
                              onClick={() => roleMutation.mutate({ id: u.id, role: "user" })}
                            >
                              <ShieldOff className="mr-2 h-4 w-4" />
                              Demote to user
                            </DropdownMenuItem>
                          ) : isModerator ? (
                            <>
                              <DropdownMenuItem
                                disabled={isSelf}
                                onClick={() => roleMutation.mutate({ id: u.id, role: "admin" })}
                              >
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                Promote to admin
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isSelf}
                                onClick={() => roleMutation.mutate({ id: u.id, role: "user" })}
                              >
                                <ShieldOff className="mr-2 h-4 w-4" />
                                Demote to user
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              <DropdownMenuItem
                                disabled={isSelf}
                                onClick={() => roleMutation.mutate({ id: u.id, role: "moderator" })}
                              >
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                Make moderator
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isSelf}
                                onClick={() => roleMutation.mutate({ id: u.id, role: "admin" })}
                              >
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                Promote to admin
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isSelf}
                            onClick={() => {
                              if (
                                confirm(
                                  `Delete ${u.email}? Their videos and comments will also be removed. This is permanent.`,
                                )
                              ) {
                                deleteMutation.mutate(u.id);
                              }
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
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
