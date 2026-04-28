import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ListVideo, Play } from "lucide-react";
import { env } from "@video-site/env/web";

import { ApiError, apiClient } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";
import { useAutoplay } from "@/hooks/use-autoplay";

interface PlaylistItem {
  videoId: string;
  position: number;
  video: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    duration: number | null;
    user: { id: string; name: string };
  };
}

interface PlaylistResponse {
  id: string;
  title: string;
  user: { id: string; name: string };
  items: PlaylistItem[];
}

interface WatchPlaylistProps {
  playlistId: string;
  currentVideoId: string;
}

export function WatchPlaylist({ playlistId, currentVideoId }: WatchPlaylistProps) {
  const { data, isLoading, error } = useQuery<PlaylistResponse>({
    queryKey: ["playlist", playlistId],
    queryFn: () => apiClient<PlaylistResponse>(`/api/playlists/${playlistId}`),
    retry: false,
  });

  const [autoplay, setAutoplay] = useAutoplay();
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentVideoId, data?.id]);

  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
    return null;
  }

  const items = data?.items ?? [];
  const currentIdx = items.findIndex((it) => it.videoId === currentVideoId);
  const position = currentIdx >= 0 ? currentIdx + 1 : null;

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border bg-secondary/40 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <ListVideo className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Playing from playlist
          </p>
          <Link
            to="/playlist/$playlistId"
            params={{ playlistId }}
            className="block truncate text-sm font-semibold text-foreground hover:text-primary"
          >
            {isLoading ? (
              <span className="inline-block h-3 w-32 animate-pulse rounded bg-secondary align-middle" />
            ) : (
              data?.title ?? "Playlist"
            )}
          </Link>
          {data && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {data.user.name}
              {position != null && items.length > 0
                ? ` · ${position} / ${items.length}`
                : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoplay}
          aria-label="Autoplay"
          onClick={() => setAutoplay(!autoplay)}
          className="flex shrink-0 items-center gap-2 rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary"
        >
          <span>Autoplay</span>
          <span
            className={
              "flex h-4 w-8 shrink-0 items-center rounded-full p-0.5 transition-colors " +
              (autoplay ? "justify-end bg-primary" : "justify-start bg-secondary border border-border")
            }
          >
            <span className="block h-3 w-3 rounded-full bg-white shadow" />
          </span>
        </button>
      </div>

      <div className="max-h-[55vh] overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-2">
                <div className="aspect-video w-28 shrink-0 animate-pulse rounded bg-secondary" />
                <div className="flex flex-1 flex-col gap-1.5 pt-1">
                  <div className="h-3 animate-pulse rounded bg-secondary" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-secondary" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">This playlist is empty.</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((it, idx) => {
              const isCurrent = it.videoId === currentVideoId;
              const thumb = it.video.thumbnailUrl
                ? `${env.VITE_SERVER_URL}${it.video.thumbnailUrl}`
                : null;
              return (
                <li key={it.videoId} ref={isCurrent ? currentRef : undefined}>
                  <Link
                    to="/watch/$videoId"
                    params={{ videoId: it.videoId }}
                    search={{ list: playlistId }}
                    className={
                      "group flex gap-2 border-l-2 px-2 py-1.5 transition-colors " +
                      (isCurrent
                        ? "border-primary bg-secondary/60"
                        : "border-transparent hover:bg-secondary/40")
                    }
                  >
                    <div className="flex w-5 shrink-0 items-center justify-center text-[11px] text-muted-foreground">
                      {isCurrent ? (
                        <Play className="h-3 w-3 fill-primary text-primary" />
                      ) : (
                        idx + 1
                      )}
                    </div>
                    <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded bg-secondary">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={it.video.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Play className="h-4 w-4 text-muted-foreground/30" />
                        </div>
                      )}
                      {it.video.duration != null && (
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[9px] font-medium text-white">
                          {formatDuration(it.video.duration)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <h3
                        className={
                          "line-clamp-2 text-xs leading-snug " +
                          (isCurrent
                            ? "font-semibold text-foreground"
                            : "font-medium text-foreground group-hover:text-primary")
                        }
                      >
                        {it.video.title}
                      </h3>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {it.video.user.name}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
