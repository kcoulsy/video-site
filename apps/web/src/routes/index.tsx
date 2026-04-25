import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Clock, Film, Flame } from "lucide-react";
import { env } from "@video-site/env/web";

import Loader from "@/components/loader";
import { VideoGrid } from "@/components/video-grid";
import type { VideoCardProps } from "@/components/video-card";
import { apiClient } from "@/lib/api-client";

type SortOption = "newest" | "popular" | "oldest";

interface FeedItem {
  id: string;
  title: string;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: string;
  user: { id: string; name: string; image: string | null };
}

interface FeedResponse {
  items: FeedItem[];
  page: number;
  limit: number;
}

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const [sort, setSort] = useState<SortOption>("newest");

  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey: ["videos", "feed", sort],
    queryFn: () => apiClient<FeedResponse>(`/api/videos?sort=${sort}&page=1&limit=24`),
  });

  const videos: VideoCardProps[] =
    data?.items.map((v) => ({
      id: v.id,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl ? `${env.VITE_SERVER_URL}${v.thumbnailUrl}` : null,
      duration: v.duration,
      viewCount: v.viewCount,
      createdAt: v.createdAt,
      user: { name: v.user.name, image: v.user.image },
    })) ?? [];

  const sortOptions: {
    value: SortOption;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "newest",
      label: "Newest",
      icon: <Clock className="h-3.5 w-3.5" />,
    },
    {
      value: "popular",
      label: "Most Viewed",
      icon: <Flame className="h-3.5 w-3.5" />,
    },
    {
      value: "oldest",
      label: "Oldest",
      icon: <Clock className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-6 flex items-center gap-2">
        {sortOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setSort(option.value)}
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

      {isLoading ? (
        <div className="py-16">
          <Loader />
        </div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Film className="h-12 w-12 text-muted-foreground/20" />
          <p className="mt-4 text-sm text-muted-foreground">
            No videos yet — be the first to upload one.
          </p>
        </div>
      ) : (
        <VideoGrid videos={videos} />
      )}
    </div>
  );
}
