import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Clock, Flame, TrendingUp } from "lucide-react";

import { VideoGrid } from "@/components/video-grid";
import type { VideoCardProps } from "@/components/video-card";

export const Route = createFileRoute("/")({
  component: HomePage,
});

// Mock data — replace with API calls (GET /api/videos?sort=...)
const MOCK_VIDEOS: VideoCardProps[] = Array.from({ length: 24 }, (_, i) => ({
  id: `video-${i + 1}`,
  title: [
    "Building a Full-Stack App with TanStack Start",
    "Advanced TypeScript Patterns You Need to Know",
    "The Future of Web Streaming Technology",
    "How to Build a Video Processing Pipeline",
    "React 19: Everything New Explained",
    "Cinema-Quality Color Grading Tutorial",
    "Understanding DASH Streaming Protocol",
    "10 Tips for Better Video Production",
  ][i % 8]!,
  thumbnailUrl: null,
  duration: [432, 1256, 892, 2100, 645, 1800, 720, 560][i % 8]!,
  viewCount: [12400, 89200, 3400, 156000, 45600, 234000, 7800, 1200][i % 8]!,
  createdAt: new Date(
    Date.now() -
      [
        86400000, 172800000, 604800000, 2592000000, 259200000, 3600000, 7200000,
        1209600000,
      ][i % 8]!,
  ).toISOString(),
  user: {
    name: ["Alex Turner", "Sarah Chen", "Mike Rodriguez", "Emma Wilson"][
      i % 4
    ]!,
    image: null,
  },
}));

type SortOption = "newest" | "popular" | "trending";

function HomePage() {
  const [sort, setSort] = useState<SortOption>("newest");

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
      value: "trending",
      label: "Trending",
      icon: <TrendingUp className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      {/* Sort filters */}
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

      <VideoGrid videos={MOCK_VIDEOS} />
    </div>
  );
}
