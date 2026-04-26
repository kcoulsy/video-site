import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";

import { formatDuration, formatRelativeTime, formatViewCount } from "@/lib/format";

export interface SearchResultItemProps {
  id: string;
  title: string;
  descriptionSnippet: string;
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: string;
  user: { name: string; image?: string | null };
  tags?: string[];
}

function sanitizeSnippet(html: string): string {
  return html.replace(/<(?!\/?mark\b)[^>]*>/gi, "");
}

export function SearchResultItem({
  id,
  title,
  descriptionSnippet,
  thumbnailUrl,
  duration,
  viewCount,
  createdAt,
  user,
  tags,
}: SearchResultItemProps) {
  return (
    <Link
      to="/watch/$videoId"
      params={{ videoId: id }}
      className="group flex flex-col gap-3 rounded-xl p-2 transition-colors hover:bg-secondary/50 sm:flex-row sm:gap-4"
    >
      <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-secondary sm:w-60 md:w-72">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <Play className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        {duration != null && (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(duration)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 py-1">
        <h3 className="line-clamp-2 text-base font-medium leading-snug transition-colors group-hover:text-primary">
          {title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatViewCount(viewCount)} views &middot; {formatRelativeTime(createdAt)}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-secondary">
            {user.image ? (
              <img src={user.image} alt={user.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted-foreground">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{user.name}</p>
        </div>
        {descriptionSnippet && (
          <p
            className="mt-2 line-clamp-2 text-xs text-muted-foreground/90 [&_mark]:bg-primary/20 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5"
            dangerouslySetInnerHTML={{ __html: sanitizeSnippet(descriptionSnippet) }}
          />
        )}
        {tags && tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
