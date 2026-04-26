import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Film, Flame, Sparkles, TrendingUp } from "lucide-react";
import { env } from "@video-site/env/web";

import { CategorySidebar } from "@/components/category-sidebar";
import { Pagination } from "@/components/pagination";
import { VideoGrid } from "@/components/video-grid";
import { VideoGridSkeleton } from "@/components/video-card-skeleton";
import type { VideoCardProps } from "@/components/video-card";
import { apiClient } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

type SortOption = "for-you" | "trending" | "newest" | "popular" | "oldest";

interface IndexSearchParams {
  sort?: SortOption;
  category?: string;
  page?: number;
}

const SORT_VALUES = new Set<SortOption>(["for-you", "trending", "newest", "popular", "oldest"]);
const PAGE_SIZE = 24;
const PERSONALIZED_SORTS = new Set<SortOption>(["for-you", "trending"]);

interface FeedItem {
  id: string;
  title: string;
  thumbnailPath?: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: string;
  user: { id: string; name: string; image: string | null };
}

interface PaginatedFeedResponse {
  items: FeedItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface SimpleFeedResponse {
  items: FeedItem[];
}

interface HistoryProgressResponse {
  items: { videoId: string; progressPercent: number }[];
}

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({ meta: [{ title: "Watchbox — Watch and share videos" }] }),
  validateSearch: (search: Record<string, unknown>): IndexSearchParams => {
    const sortRaw = typeof search.sort === "string" ? (search.sort as SortOption) : undefined;
    const sort: SortOption | undefined = sortRaw && SORT_VALUES.has(sortRaw) ? sortRaw : undefined;
    const category =
      typeof search.category === "string" && search.category.trim().length > 0
        ? search.category.trim()
        : undefined;
    const pageNum = Number(search.page);
    const page = Number.isFinite(pageNum) && pageNum > 1 ? Math.floor(pageNum) : undefined;
    return { sort, category, page };
  },
});

function HomePage() {
  const { sort: sortParam, category, page: pageParam } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: sessionData } = authClient.useSession();
  const isAuthed = !!sessionData?.user;

  const sort: SortOption = sortParam ?? "for-you";
  const isPersonalized = PERSONALIZED_SORTS.has(sort);
  // Personalized feeds and category browsing don't share endpoints; reset page when switching.
  const page = isPersonalized || category == null ? (pageParam ?? 1) : (pageParam ?? 1);

  const personalizedEndpoint =
    sort === "for-you" ? "/api/recommendations/feed" : "/api/recommendations/trending";

  const catalogParams = new URLSearchParams({
    sort: sort === "popular" ? "popular" : sort === "oldest" ? "oldest" : "newest",
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  if (category) catalogParams.set("category", category);

  const { data: paginatedData, isLoading: paginatedLoading } = useQuery<PaginatedFeedResponse>({
    queryKey: ["videos", "feed", sort, category ?? null, page],
    queryFn: () => apiClient<PaginatedFeedResponse>(`/api/videos?${catalogParams.toString()}`),
    placeholderData: (prev) => prev,
    enabled: !isPersonalized || category != null,
  });

  const { data: personalizedData, isLoading: personalizedLoading } = useQuery<SimpleFeedResponse>({
    queryKey: ["recommendations", sort, isAuthed],
    queryFn: () => apiClient<SimpleFeedResponse>(`${personalizedEndpoint}?limit=${PAGE_SIZE}`),
    enabled: isPersonalized && category == null,
  });

  const usingPersonalized = isPersonalized && category == null;
  const items: FeedItem[] = usingPersonalized
    ? (personalizedData?.items ?? [])
    : (paginatedData?.items ?? []);
  const isLoading = usingPersonalized ? personalizedLoading : paginatedLoading;

  const { data: historyData } = useQuery<HistoryProgressResponse>({
    queryKey: ["history", "progress-map"],
    queryFn: () => apiClient<HistoryProgressResponse>("/api/history?limit=50"),
    enabled: isAuthed,
  });

  const progressByVideoId = new Map<string, number>();
  for (const item of historyData?.items ?? []) {
    if (item.progressPercent > 0 && item.progressPercent < 0.9) {
      progressByVideoId.set(item.videoId, item.progressPercent);
    }
  }

  const videos: VideoCardProps[] = items.map((v) => ({
    id: v.id,
    title: v.title,
    thumbnailUrl: v.thumbnailUrl ? `${env.VITE_SERVER_URL}${v.thumbnailUrl}` : null,
    duration: v.duration,
    viewCount: v.viewCount,
    createdAt: v.createdAt,
    user: { name: v.user.name, image: v.user.image },
    progressPercent: progressByVideoId.get(v.id),
  }));

  const totalPages = usingPersonalized ? 0 : (paginatedData?.totalPages ?? 0);

  const sortOptions: {
    value: SortOption;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { value: "for-you", label: "For You", icon: <Sparkles className="h-3.5 w-3.5" /> },
    { value: "trending", label: "Trending", icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { value: "newest", label: "Newest", icon: <Clock className="h-3.5 w-3.5" /> },
    { value: "popular", label: "Most Viewed", icon: <Flame className="h-3.5 w-3.5" /> },
    { value: "oldest", label: "Oldest", icon: <Clock className="h-3.5 w-3.5" /> },
  ];

  const visibleSortOptions = sortOptions;

  return (
    <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6">
      <CategorySidebar selected={category} />

      <div className="min-w-0 flex-1">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {visibleSortOptions.map((option) => (
            <button
              key={option.value}
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, sort: option.value, page: undefined }),
                  replace: true,
                })
              }
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                sort === option.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>

        {isLoading && items.length === 0 ? (
          <VideoGridSkeleton count={PAGE_SIZE} />
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Film className="h-12 w-12 text-muted-foreground/20" />
            <p className="mt-4 text-sm text-muted-foreground">
              {category
                ? "No videos match this category yet."
                : sort === "for-you"
                  ? "Watch a few videos and we'll start tailoring your feed."
                  : "No videos yet — be the first to upload one."}
            </p>
          </div>
        ) : (
          <>
            <VideoGrid videos={videos} />
            {!usingPersonalized && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={(next) =>
                  navigate({
                    search: (prev) => ({ ...prev, page: next === 1 ? undefined : next }),
                  })
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
