import { useMutation } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";

import { ApiError, apiClient } from "@/lib/api-client";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment / bullying" },
  { value: "sexual", label: "Sexual content" },
  { value: "violence", label: "Violence / graphic content" },
  { value: "illegal", label: "Illegal activity" },
  { value: "other", label: "Other" },
];

interface ReportButtonProps {
  targetType: "video" | "comment";
  targetId: string;
  isAuthenticated: boolean;
  variant?: "icon" | "button";
  className?: string;
}

export function ReportButton({
  targetType,
  targetId,
  isAuthenticated,
  variant = "button",
  className,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("spam");
  const [reason, setReason] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      apiClient(`/api/moderation/reports`, {
        method: "POST",
        body: JSON.stringify({
          targetType,
          targetId,
          reasonCategory: category,
          reason: reason.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Thanks — moderators will review it.");
      setOpen(false);
      setReason("");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to submit report");
    },
  });

  if (!isAuthenticated) return null;

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Report"
          className={
            className ??
            "rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          }
        >
          <Flag className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className={className ?? "gap-1.5 rounded-full"}
          onClick={() => setOpen(true)}
        >
          <Flag className="h-4 w-4" />
          <span className="hidden sm:inline">Report</span>
        </Button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-lg">
            <h3 className="text-lg font-semibold">Report {targetType}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell moderators what's wrong with this {targetType}.
            </p>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Details (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="Add any context that will help moderators."
              className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
            />

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
                {submit.isPending ? "Submitting..." : "Submit report"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
