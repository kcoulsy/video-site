import { Flag } from "lucide-react";
import { useState } from "react";
import { Button } from "@video-site/ui/components/button";

import { ReportDialog } from "./report-dialog";

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

      <ReportDialog
        open={open}
        onClose={() => setOpen(false)}
        targetType={targetType}
        targetId={targetId}
      />
    </>
  );
}
