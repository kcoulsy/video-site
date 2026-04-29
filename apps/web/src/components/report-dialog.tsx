import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
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

interface Props {
  open: boolean;
  onClose: () => void;
  targetType: "video" | "comment";
  targetId: string;
}

export function ReportDialog({ open, onClose, targetType, targetId }: Props) {
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
      onClose();
      setReason("");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to submit report");
    },
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
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
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Submitting..." : "Submit report"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
