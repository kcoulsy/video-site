import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";

import { ApiError, apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";



export const Route = createLazyFileRoute("/admin/reports")({
  component: AdminReports,
});

interface ReportRow {
  id: string;
  reporterId: string;
  reporterName: string | null;
  reporterEmail: string | null;
  targetType: "video" | "comment";
  targetId: string;
  reasonCategory: string;
  reason: string | null;
  status: "pending" | "resolved" | "dismissed";
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

interface ReportsResponse {
  items: ReportRow[];
  page: number;
  limit: number;
  total: number;
}

const PAGE_SIZE = 25;

function AdminReports() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("pending");

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (status) params.set("status", status);

  const { data, isLoading } = useQuery<ReportsResponse>({
    queryKey: ["admin", "reports", page, status],
    queryFn: () => apiClient<ReportsResponse>(`/api/moderation/reports?${params}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
  };
  const onErr = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : "Action failed");

  const resolve = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiClient(`/api/moderation/reports/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ note }),
      }),
    onSuccess: () => {
      toast.success("Report resolved");
      invalidate();
    },
    onError: onErr,
  });

  const dismiss = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiClient(`/api/moderation/reports/${id}/dismiss`, {
        method: "POST",
        body: JSON.stringify({ note }),
      }),
    onSuccess: () => {
      toast.success("Report dismissed");
      invalidate();
    },
    onError: onErr,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {total} {status || "all"}
      </p>

      <div className="mt-4 flex gap-2">
        {["pending", "resolved", "dismissed", ""].map((s) => (
          <Button
            key={s || "all"}
            variant={status === s ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s || "All"}
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
            No reports
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((r) => (
              <div key={r.id} className="flex gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                      {r.targetType}
                    </span>
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-500">
                      {r.reasonCategory}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                        r.status === "pending"
                          ? "bg-blue-500/15 text-blue-500"
                          : r.status === "resolved"
                            ? "bg-emerald-500/15 text-emerald-500"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  {r.reason && <p className="mt-2 text-sm">{r.reason}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      reported by{" "}
                      <span className="text-foreground">{r.reporterName ?? "deleted user"}</span>
                    </span>
                    <span>{formatRelativeTime(r.createdAt)}</span>
                    {r.targetType === "video" ? (
                      <Link
                        to="/watch/$videoId"
                        params={{ videoId: r.targetId }}
                        className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        view target
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">comment id: {r.targetId}</span>
                    )}
                  </div>
                  {r.resolutionNote && (
                    <p className="mt-2 text-xs italic text-muted-foreground">
                      Resolution note: {r.resolutionNote}
                    </p>
                  )}
                </div>
                {r.status === "pending" && (
                  <div className="flex items-start gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const note = prompt("Resolution note (optional):") ?? undefined;
                        resolve.mutate({ id: r.id, note });
                      }}
                      title="Resolve (acted on)"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const note = prompt("Dismissal note (optional):") ?? undefined;
                        dismiss.mutate({ id: r.id, note });
                      }}
                      title="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
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
