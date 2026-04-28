import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Layers } from "lucide-react";

import { apiClient } from "@/lib/api-client";

interface CategoryListItem {
  id: string;
  slug: string;
  name: string;
  mode: "any" | "all";
  sortOrder: number;
  tags: { id: string; slug: string; name: string }[];
}

interface CategoriesResponse {
  items: CategoryListItem[];
}

interface CategorySidebarProps {
  selected?: string;
}

export function CategorySidebar({ selected }: CategorySidebarProps) {
  const { data, isLoading } = useQuery<CategoriesResponse>({
    queryKey: ["categories"],
    queryFn: () => apiClient<CategoriesResponse>("/api/categories"),
    staleTime: 5 * 60 * 1000,
  });

  const items = data?.items ?? [];

  return (
    <aside className="hidden w-56 shrink-0 md:block">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Layers className="h-3.5 w-3.5" />
        Categories
      </div>
      <nav className="flex flex-col gap-1">
        <Link
          to="/"
          search={(prev: Record<string, unknown>) => ({
            ...prev,
            category: undefined,
            page: undefined,
          })}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            !selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
          }`}
        >
          All videos
        </Link>
        {isLoading && items.length === 0 ? (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">Loading…</div>
        ) : null}
        {items.map((cat) => {
          const active = selected === cat.slug;
          return (
            <Link
              key={cat.id}
              to="/"
              search={(prev: Record<string, unknown>) => ({
                ...prev,
                category: active ? undefined : cat.slug,
                page: undefined,
              })}
              className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
                active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
              }`}
              title={cat.tags.map((t) => t.name).join(cat.mode === "all" ? " AND " : " OR ")}
            >
              <span className="truncate">{cat.name}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
