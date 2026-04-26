import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@video-site/ui/components/button";

import { apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/admin/audit")({
  component: AdminAudit,
});

interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditResponse {
  items: AuditRow[];
  page: number;
  limit: number;
  total: number;
}

const PAGE_SIZE = 50;

function AdminAudit() {
  const [page, setPage] = useState(1);
  const [targetType, setTargetType] = useState<string>("");
  const [action, setAction] = useState<string>("");

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (targetType) params.set("targetType", targetType);
  if (action) params.set("action", action);

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ["admin", "audit", page, targetType, action],
    queryFn: () => apiClient<AuditResponse>(`/api/moderation/actions?${params}`),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="mt-1 text-sm text-muted-foreground">{total} actions</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <select
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="">All targets</option>
          <option value="user">User</option>
          <option value="video">Video</option>
          <option value="comment">Comment</option>
          <option value="report">Report</option>
        </select>
        <input
          placeholder="Filter action (e.g. ban)"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
            No entries
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Actor</th>
                <th className="px-4 py-2 text-left">Action</th>
                <th className="px-4 py-2 text-left">Target</th>
                <th className="px-4 py-2 text-left">Reason / metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((r) => (
                <tr key={r.id} className="hover:bg-secondary/20">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                    {formatRelativeTime(r.createdAt)}
                  </td>
                  <td className="px-4 py-2">{r.actorName ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.targetType}:{r.targetId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.reason ?? ""}
                    {r.metadata && (
                      <code className="ml-1 rounded bg-secondary px-1 py-0.5">
                        {JSON.stringify(r.metadata)}
                      </code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
