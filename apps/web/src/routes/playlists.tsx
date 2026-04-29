import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { ListVideo } from "lucide-react";

import Loader from "@/components/loader";
import { Pagination } from "@/components/pagination";
import { PlaylistCard, type PlaylistCardData } from "@/components/playlist-card";
import { apiClient } from "@/lib/api-client";

interface BrowseResponse {
  items: (PlaylistCardData & {
    description: string | null;
    createdAt: string;
  })[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface BrowseSearchParams {
  page?: number;
}

export const Route = createFileRoute("/playlists")({
  component: BrowsePlaylistsPage,
  head: () => ({ meta: [{ title: `Browse Playlists — ${env.VITE_APP_NAME}` }] }),
  validateSearch: (search: Record<string, unknown>): BrowseSearchParams => {
    const pageNum = Number(search.page);
    return {
      page: Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1,
    };
  },
});

function BrowsePlaylistsPage() {
  const { page: pageParam } = Route.useSearch();
  const page = pageParam ?? 1;
  const navigate = Route.useNavigate();

  const params = new URLSearchParams({ page: String(page), limit: "24" });
  const { data, isLoading } = useQuery<BrowseResponse>({
    queryKey: ["playlists", "browse", page],
    queryFn: () => apiClient<BrowseResponse>(`/api/playlists?${params.toString()}`),
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
      <div className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ListVideo className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Browse Playlists</h1>
        </div>
        <Link to="/playlists/mine" className="text-sm font-medium text-primary hover:underline">
          Your playlists →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <ListVideo className="h-12 w-12 text-muted-foreground/30" />
          <p className="mt-4 text-sm text-muted-foreground">No public playlists yet.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((p) => (
              <PlaylistCard key={p.id} playlist={p} showOwner />
            ))}
          </div>
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
