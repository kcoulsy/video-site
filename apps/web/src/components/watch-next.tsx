import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { env } from "@video-site/env/web";

import { apiClient } from "@/lib/api-client";
import { formatDuration, formatRelativeTime, formatViewCount } from "@/lib/format";

interface FeedItem {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: string;
  user: { id: string; name: string; image: string | null };
}

interface FeedResponse {
  items: FeedItem[];
}

interface WatchNextProps {
  currentVideoId: string;
}

export function WatchNext({ currentVideoId }: WatchNextProps) {
  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey: ["videos", "related", currentVideoId],
    queryFn: () => apiClient<FeedResponse>(`/api/videos/${currentVideoId}/related?limit=15`),
  });

  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-semibold text-foreground">Up next</h2>
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <div className="aspect-video w-40 shrink-0 animate-pulse rounded-lg bg-secondary" />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="h-3 animate-pulse rounded bg-secondary" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-secondary" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No other videos yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((v) => (
            <li key={v.id}>
              <Link
                to="/watch/$videoId"
                params={{ videoId: v.id }}
                className="group flex gap-2 rounded-lg p-1 transition-colors hover:bg-secondary/60"
              >
                <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-secondary">
                  {v.thumbnailUrl ? (
                    <img
                      src={`${env.VITE_SERVER_URL}${v.thumbnailUrl}`}
                      alt={v.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Play className="h-6 w-6 text-muted-foreground/30" />
                    </div>
                  )}
                  {v.duration != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-px text-[10px] font-medium text-white">
                      {formatDuration(v.duration)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h3 className="line-clamp-2 text-xs font-medium leading-snug text-foreground group-hover:text-primary">
                    {v.title}
                  </h3>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{v.user.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {formatViewCount(v.viewCount)} views &middot; {formatRelativeTime(v.createdAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
