import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Flame, Search, SearchX, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { env } from "@video-site/env/web";

import { Pagination } from "@/components/pagination";
import { VideoGrid } from "@/components/video-grid";
import { VideoGridSkeleton } from "@/components/video-card-skeleton";
import type { VideoCardProps } from "@/components/video-card";
import { apiClient } from "@/lib/api-client";

type SortMode = "relevance" | "date" | "views";

interface SearchSearchParams {
  q: string;
  sort?: SortMode;
  page?: number;
}

const SORT_VALUES = new Set<SortMode>(["relevance", "date", "views"]);

export const Route = createFileRoute("/search")({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): SearchSearchParams => {
    const sortRaw = typeof search.sort === "string" ? (search.sort as SortMode) : "relevance";
    const sort: SortMode = SORT_VALUES.has(sortRaw) ? sortRaw : "relevance";
    const pageNum = Number(search.page);
    return {
      q: typeof search.q === "string" ? search.q : "",
      sort,
      page: Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1,
    };
  },
});

interface SearchResult {
  id: string;
  title: string;
  descriptionSnippet: string;
  duration: number | null;
  viewCount: number;
  likeCount: number;
  createdAt: string;
  thumbnailUrl: string | null;
  tags: string[];
  user: { id: string; name: string; image: string | null };
  relevanceScore: number;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  query: string;
}

const SORT_OPTIONS: { value: SortMode; label: string; icon: React.ReactNode }[] = [
  { value: "relevance", label: "Relevance", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { value: "date", label: "Upload Date", icon: <Clock className="h-3.5 w-3.5" /> },
  { value: "views", label: "View Count", icon: <Flame className="h-3.5 w-3.5" /> },
];

function absoluteUrl(path: string | null): string | null {
  if (!path) return null;
  return `${env.VITE_SERVER_URL}${path}`;
}

function SearchPage() {
  const { q, sort: sortParam, page: pageParam } = Route.useSearch();
  const sort: SortMode = sortParam ?? "relevance";
  const page: number = pageParam ?? 1;
  const navigate = Route.useNavigate();

  const trimmed = q.trim();

  useEffect(() => {
    const previous = document.title;
    document.title = trimmed ? `Search: ${trimmed} — Watchbox` : "Search — Watchbox";
    return () => {
      document.title = previous;
    };
  }, [trimmed]);

  const params = new URLSearchParams({
    q: trimmed,
    sort,
    page: String(page),
    limit: "20",
  });

  const { data, isLoading, error } = useQuery<SearchResponse>({
    queryKey: ["search", trimmed, sort, page],
    queryFn: () => apiClient<SearchResponse>(`/api/search?${params.toString()}`),
    enabled: trimmed.length > 0,
    placeholderData: (prev) => prev,
  });

  if (!trimmed) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="flex flex-col items-center justify-center py-24">
          <Search className="h-16 w-16 text-muted-foreground/20" />
          <h2 className="mt-4 text-lg font-medium">Search for videos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter a search term in the search bar above
          </p>
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <VideoGridSkeleton count={20} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Search failed</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please try again in a moment.</p>
      </div>
    );
  }

  const results = data?.results ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  const videos: VideoCardProps[] = results.map((r) => ({
    id: r.id,
    title: r.title,
    thumbnailUrl: absoluteUrl(r.thumbnailUrl),
    duration: r.duration,
    viewCount: r.viewCount,
    createdAt: r.createdAt,
    user: { name: r.user.name, image: r.user.image },
  }));

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-medium">
            {total > 0 ? (
              <>
                About <span className="font-semibold">{total.toLocaleString()}</span>{" "}
                {total === 1 ? "result" : "results"} for{" "}
                <span className="text-primary">&ldquo;{trimmed}&rdquo;</span>
              </>
            ) : (
              <>
                No results for <span className="text-primary">&ldquo;{trimmed}&rdquo;</span>
              </>
            )}
          </h1>
        </div>

        {total > 0 && (
          <div className="flex items-center gap-1 self-start rounded-lg bg-secondary p-1">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  navigate({
                    search: (prev) => ({ ...prev, sort: option.value, page: 1 }),
                  })
                }
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  sort === option.value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.icon}
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <SearchX className="h-16 w-16 text-muted-foreground/20" />
          <h2 className="mt-4 text-lg font-medium">No results found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try different keywords or check your spelling
          </p>
          <Link to="/" className="mt-6 text-sm text-primary hover:underline">
            Browse all videos
          </Link>
        </div>
      ) : (
        <>
          <VideoGrid videos={videos} />

          <Pagination
            page={page}
            totalPages={totalPages}
            onChange={(next) => navigate({ search: (prev) => ({ ...prev, page: next }) })}
          />
        </>
      )}
    </div>
  );
}
