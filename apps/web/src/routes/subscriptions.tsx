import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { env } from "@video-site/env/web";

import Loader from "@/components/loader";
import { Pagination } from "@/components/pagination";
import { VideoGrid } from "@/components/video-grid";
import { getUser } from "@/functions/get-user";
import { apiClient } from "@/lib/api-client";

interface FeedVideo {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: string;
  publishedAt: string | null;
  user: { id: string; name: string; handle: string | null; image: string | null };
}

interface FeedResponse {
  items: FeedVideo[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FeedSearchParams {
  page?: number;
}

export const Route = createFileRoute("/subscriptions")({
  component: SubscriptionsPage,
  head: () => ({ meta: [{ title: `Subscriptions — ${env.VITE_APP_NAME}` }] }),
  validateSearch: (search: Record<string, unknown>): FeedSearchParams => {
    const pageNum = Number(search.page);
    return { page: Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1 };
  },
  beforeLoad: async () => {
    const session = await getUser();
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
});

function abs(path: string | null): string | null {
  if (!path) return null;
  return `${env.VITE_SERVER_URL}${path}`;
}

function SubscriptionsPage() {
  const { page: pageParam } = Route.useSearch();
  const page = pageParam ?? 1;
  const navigate = Route.useNavigate();

  const params = new URLSearchParams({ page: String(page), limit: "24" });
  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey: ["subscriptions-feed", page],
    queryFn: () => apiClient<FeedResponse>(`/api/me/subscriptions/feed?${params.toString()}`),
    placeholderData: (prev) => prev,
  });

  if (isLoading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader />
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-8 flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Subscriptions</h1>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Users className="h-12 w-12 text-muted-foreground/30" />
          <p className="mt-4 text-sm text-muted-foreground">
            You haven't subscribed to any creators yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Visit a creator's profile and click Subscribe to follow them.
          </p>
        </div>
      ) : (
        <>
          <VideoGrid
            videos={items.map((v) => ({
              id: v.id,
              title: v.title,
              thumbnailUrl: abs(v.thumbnailUrl),
              duration: v.duration,
              viewCount: v.viewCount,
              createdAt: v.createdAt,
              user: { name: v.user.name, image: abs(v.user.image) },
            }))}
          />
          <Pagination
            page={page}
            totalPages={data?.totalPages ?? 1}
            onChange={(next) => navigate({ search: { page: next } })}
          />
        </>
      )}
    </div>
  );
}
