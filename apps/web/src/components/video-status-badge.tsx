import { AlertCircle, CheckCircle, Clock, CloudUpload, Loader2 } from "lucide-react";

export type VideoStatus = "uploading" | "uploaded" | "processing" | "ready" | "failed";

const STATUS_CONFIG: Record<
  VideoStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  uploading: {
    label: "Uploading",
    icon: <CloudUpload className="h-3.5 w-3.5 animate-pulse" />,
    className: "text-blue-400 bg-blue-400/10",
  },
  uploaded: {
    label: "Queued",
    icon: <Clock className="h-3.5 w-3.5" />,
    className: "text-yellow-400 bg-yellow-400/10",
  },
  processing: {
    label: "Processing",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    className: "text-amber-400 bg-amber-400/10",
  },
  ready: {
    label: "Ready",
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    className: "text-emerald-400 bg-emerald-400/10",
  },
  failed: {
    label: "Failed",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    className: "text-red-400 bg-red-400/10",
  },
};

interface VideoStatusBadgeProps {
  status: VideoStatus;
  progressPercent?: number | null;
}

export function VideoStatusBadge({ status, progressPercent }: VideoStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const showProgress =
    (status === "processing" || status === "uploading") &&
    typeof progressPercent === "number" &&
    progressPercent > 0 &&
    progressPercent < 100;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
      {showProgress ? (
        <span className="tabular-nums">· {Math.round(progressPercent!)}%</span>
      ) : null}
    </span>
  );
}
