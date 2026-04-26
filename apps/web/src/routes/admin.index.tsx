import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, MessageSquare, TrendingUp, Users, Video } from "lucide-react";

import { apiClient } from "@/lib/api-client";
import { formatViewCount } from "@/lib/format";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
  head: () => ({ meta: [{ title: "Admin overview — Watchbox" }] }),
});

interface AdminStats {
  users: number;
  videos: number;
  comments: number;
  recentSignups: number;
  recentUploads: number;
  videosByStatus: Record<string, number>;
}

function AdminOverview() {
  const { data, isLoading } = useQuery<AdminStats>({
    queryKey: ["admin", "stats"],
    queryFn: () => apiClient<AdminStats>("/api/admin/stats"),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = [
    { label: "Total Users", value: formatViewCount(data.users), Icon: Users },
    { label: "Total Videos", value: formatViewCount(data.videos), Icon: Video },
    { label: "Total Comments", value: formatViewCount(data.comments), Icon: MessageSquare },
    { label: "Signups (7d)", value: String(data.recentSignups), Icon: TrendingUp },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">Platform-wide stats</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.Icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">{stat.label}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Videos by status</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {Object.entries(data.videosByStatus).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between">
                <span className="capitalize text-muted-foreground">{status}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </li>
            ))}
            {Object.keys(data.videosByStatus).length === 0 && (
              <li className="text-sm text-muted-foreground">No videos yet</li>
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Activity (last 7 days)</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">New signups</span>
              <span className="font-medium tabular-nums">{data.recentSignups}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">New uploads</span>
              <span className="font-medium tabular-nums">{data.recentUploads}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
