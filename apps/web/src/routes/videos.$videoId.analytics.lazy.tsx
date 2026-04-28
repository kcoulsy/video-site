import { useQuery } from "@tanstack/react-query";
import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ChartBar } from "lucide-react";
import { useState } from "react";
import { Button } from "@video-site/ui/components/button";

import Loader from "@/components/loader";
import { ViewsBarChart } from "@/components/views-bar-chart";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatViewCount } from "@/lib/format";

export const Route = createLazyFileRoute("/videos/$videoId/analytics")({
  component: VideoAnalyticsPage,
});

interface VideoAnalyticsResponse {
  range: "7d" | "30d" | "90d";
  video: {
    id: string;
    title: string;
    viewCount: number;
    likeCount: number;
    dislikeCount: number;
    commentCount: number;
  };
  rangeViews: number;
  viewsByDay: { date: string; views: number }[];
}

function VideoAnalyticsPage() {
  const { videoId } = Route.useParams();
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");

  const { data, isLoading, error } = useQuery<VideoAnalyticsResponse>({
    queryKey: ["video-analytics", videoId, range],
    queryFn: () =>
      apiClient<VideoAnalyticsResponse>(`/api/videos/${videoId}/analytics?range=${range}`),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error || !data) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">
          {status === 403
            ? "Not your video"
            : status === 404
              ? "Video not found"
              : "Couldn't load analytics"}
        </h1>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      <div className="mb-6">
        <Button variant="ghost" size="sm" className="gap-1" render={<Link to="/dashboard" />}>
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Button>
      </div>

      <div className="mb-8 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Analytics</p>
          <h1 className="mt-1 text-2xl font-semibold">{data.video.title}</h1>
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as "7d" | "30d" | "90d")}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Views in range", value: formatViewCount(data.rangeViews) },
          { label: "Total views", value: formatViewCount(data.video.viewCount) },
          { label: "Likes", value: formatViewCount(data.video.likeCount) },
          { label: "Comments", value: formatViewCount(data.video.commentCount) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <ChartBar className="h-4 w-4" />
          <h2 className="text-sm font-medium">Views by day</h2>
        </div>
        <ViewsBarChart data={data.viewsByDay} height={200} />
      </div>
    </div>
  );
}
