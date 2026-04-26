import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { History, Play } from "lucide-react";
import { env } from "@video-site/env/web";

import { apiClient } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";

import { WatchProgressBar } from "./watch-progress-bar";

interface ContinueItem {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  user: { name: string };
  progressPercent: number;
}

interface ContinueResponse {
  items: ContinueItem[];
}

export function ContinueWatching() {
  const { data } = useQuery<ContinueResponse>({
    queryKey: ["recommendations", "continue-watching"],
    queryFn: () => apiClient<ContinueResponse>("/api/recommendations/continue-watching?limit=10"),
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <History className="h-4 w-4" />
        Continue watching
      </h2>
      <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2 [scrollbar-width:thin]">
        {items.map((v) => (
          <Link
            key={v.id}
            to="/watch/$videoId"
            params={{ videoId: v.id }}
            className="group flex w-64 shrink-0 flex-col"
          >
            <div className="relative aspect-video overflow-hidden rounded-lg bg-secondary">
              {v.thumbnailUrl ? (
                <img
                  src={`${env.VITE_SERVER_URL}${v.thumbnailUrl}`}
                  alt={v.title}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Play className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
              {v.duration != null && (
                <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {formatDuration(v.duration)}
                </span>
              )}
              <WatchProgressBar progressPercent={v.progressPercent} />
            </div>
            <h3 className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-foreground group-hover:text-primary">
              {v.title}
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{v.user.name}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
