import { Link } from "@tanstack/react-router";
import { ListVideo, Play } from "lucide-react";
import { env } from "@video-site/env/web";

import { formatRelativeTime } from "@/lib/format";

export interface PlaylistCardData {
  id: string;
  title: string;
  visibility?: "public" | "unlisted" | "private";
  itemCount: number;
  thumbnailUrl: string | null;
  updatedAt: string;
  user?: {
    id: string;
    name: string;
    handle: string | null;
    image: string | null;
  } | null;
}

function absoluteUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return `${env.VITE_SERVER_URL}${path}`;
}

interface Props {
  playlist: PlaylistCardData;
  showOwner?: boolean;
  showVisibility?: boolean;
}

export function PlaylistCard({ playlist, showOwner = false, showVisibility = false }: Props) {
  const thumbnail = absoluteUrl(playlist.thumbnailUrl);
  return (
    <Link to="/playlist/$playlistId" params={{ playlistId: playlist.id }} className="group block">
      <div className="relative aspect-video overflow-hidden bg-secondary">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={playlist.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <ListVideo className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">
          <Play className="h-3 w-3" />
          {playlist.itemCount}
        </div>
      </div>
      <div className="mt-2">
        <h3 className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">
          {playlist.title}
        </h3>
        <p className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
          {showVisibility && playlist.visibility ? `${playlist.visibility} · ` : ""}
          {showOwner && playlist.user ? `${playlist.user.name} · ` : ""}
          updated {formatRelativeTime(playlist.updatedAt)}
        </p>
      </div>
    </Link>
  );
}
