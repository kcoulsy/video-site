import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Grid3x3, List, Play, Search, SearchX } from "lucide-react";

import { VideoCard, type VideoCardProps } from "@/components/video-card";
import { VideoGrid } from "@/components/video-grid";
import {
  formatDuration,
  formatRelativeTime,
  formatViewCount,
} from "@/lib/format";

export const Route = createFileRoute("/search")({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
  }),
});

// Mock results — replace with GET /api/search?q=...
const MOCK_RESULTS: VideoCardProps[] = [
  "Building a Full-Stack App with TanStack Start",
  "Advanced TypeScript Patterns You Need to Know",
  "The Future of Web Streaming Technology",
  "How to Build a Video Processing Pipeline",
  "React 19: Everything New Explained",
  "Cinema-Quality Color Grading Tutorial",
  "Understanding DASH Streaming Protocol",
  "10 Tips for Better Video Production",
].map((title, i) => ({
  id: `search-${i + 1}`,
  title,
  thumbnailUrl: null,
  duration: [432, 1256, 892, 2100, 645, 1800, 720, 560][i]!,
  viewCount: [12400, 89200, 3400, 156000, 45600, 234000, 7800, 1200][i]!,
  createdAt: new Date(
    Date.now() -
      [
        86400000, 172800000, 604800000, 2592000000, 259200000, 3600000, 7200000,
        1209600000,
      ][i]!,
  ).toISOString(),
  user: {
    name: ["Alex Turner", "Sarah Chen", "Mike Rodriguez", "Emma Wilson"][
      i % 4
    ]!,
    image: null,
  },
}));

function SearchPage() {
  const { q } = Route.useSearch();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // TODO: Replace with useQuery call to search API
  const results = q ? MOCK_RESULTS : [];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      {q ? (
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-medium">
            Results for{" "}
            <span className="text-primary">&ldquo;{q}&rdquo;</span>
          </h1>
          <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`rounded-md p-1.5 transition-colors ${viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`rounded-md p-1.5 transition-colors ${viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {!q ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Search className="h-16 w-16 text-muted-foreground/20" />
          <h2 className="mt-4 text-lg font-medium">Search for videos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter a search term in the search bar above
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <SearchX className="h-16 w-16 text-muted-foreground/20" />
          <h2 className="mt-4 text-lg font-medium">No results found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try different keywords or check your spelling
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <VideoGrid videos={results} />
      ) : (
        <div className="space-y-2">
          {results.map((video, i) => (
            <div
              key={video.id}
              className="animate-fade-slide-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <SearchListItem {...video} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchListItem(props: VideoCardProps) {
  return (
    <Link
      to="/watch/$videoId"
      params={{ videoId: props.id }}
      className="group flex gap-4 rounded-xl p-2 transition-colors hover:bg-secondary/50"
    >
      <div className="relative aspect-video w-64 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {props.thumbnailUrl ? (
          <img
            src={props.thumbnailUrl}
            alt={props.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <Play className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        {props.duration != null && (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(props.duration)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 py-1">
        <h3 className="line-clamp-2 text-base font-medium transition-colors group-hover:text-primary">
          {props.title}
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {props.user.name}
        </p>
        <p className="text-sm text-muted-foreground">
          {formatViewCount(props.viewCount)} views &middot;{" "}
          {formatRelativeTime(props.createdAt)}
        </p>
      </div>
    </Link>
  );
}
