import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";

import {
  formatDuration,
  formatViewCount,
  formatRelativeTime,
} from "@/lib/format";

import { WatchProgressBar } from "./watch-progress-bar";

export interface VideoCardProps {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: string;
  user: { name: string; image?: string | null };
  progressPercent?: number;
}

export function VideoCard({
  id,
  title,
  thumbnailUrl,
  duration,
  viewCount,
  createdAt,
  user,
  progressPercent,
}: VideoCardProps) {
  return (
    <Link to="/watch/$videoId" params={{ videoId: id }} className="group block">
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden rounded-xl bg-secondary">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <Play className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}

        {/* Duration badge */}
        {duration != null && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
            {formatDuration(duration)}
          </span>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-primary/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {progressPercent != null && (
          <WatchProgressBar progressPercent={progressPercent} />
        )}
      </div>

      {/* Info */}
      <div className="mt-3 flex gap-3">
        <div className="mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded-full bg-secondary">
          {user.image ? (
            <img
              src={user.image}
              alt={user.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{user.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatViewCount(viewCount)} views &middot;{" "}
            {formatRelativeTime(createdAt)}
          </p>
        </div>
      </div>
    </Link>
  );
}
