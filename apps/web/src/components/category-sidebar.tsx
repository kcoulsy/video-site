import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

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
  const allActive = !selected;

  return (
    <aside className="hidden w-60 shrink-0 md:block">
      <div className="sticky top-20">
        <div className="mb-3 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Categories
        </div>

        <nav className="flex flex-col">
          {/* "All" — chapter 00 */}
          <ChapterLink
            index={0}
            label="All Videos"
            active={allActive}
            search={(prev: Record<string, unknown>) => ({
              ...prev,
              category: undefined,
              page: undefined,
            })}
          />

          {isLoading && items.length === 0 ? (
            <div className="mt-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
              Loading reel…
            </div>
          ) : null}

          {items.map((cat, i) => {
            const active = selected === cat.slug;
            return (
              <ChapterLink
                key={cat.id}
                index={i + 1}
                label={cat.name}
                active={active}
                title={cat.tags
                  .map((t) => t.name)
                  .join(cat.mode === "all" ? " AND " : " OR ")}
                search={(prev: Record<string, unknown>) => ({
                  ...prev,
                  category: active ? undefined : cat.slug,
                  page: undefined,
                })}
              />
            );
          })}
        </nav>

        {/* Sprocket footer — purely decorative film-strip flourish */}
        <div className="mt-5 flex gap-1.5 border-t border-border/60 pt-4 opacity-60">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className="h-1 w-1 rounded-full bg-muted-foreground/40"
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

interface ChapterLinkProps {
  index: number;
  label: string;
  active: boolean;
  title?: string;
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
}

function ChapterLink({ index, label, active, title, search }: ChapterLinkProps) {
  return (
    <Link
      to="/"
      search={search}
      title={title}
      className={`group relative flex items-center gap-3 py-2 pl-4 pr-2 transition-all duration-200 ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {/* Left edge accent — glowing bar when active, hairline on hover */}
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-r-sm transition-all duration-300 ${
          active
            ? "h-7 w-[3px] bg-primary shadow-[0_0_12px_var(--primary)]"
            : "h-3 w-px bg-border group-hover:h-5 group-hover:bg-foreground/40"
        }`}
      />

      {/* Chapter number */}
      <span
        className={`font-mono text-[10px] tabular-nums tracking-tight transition-colors ${
          active ? "text-primary" : "text-muted-foreground/60 group-hover:text-muted-foreground"
        }`}
      >
        {String(index).padStart(2, "0")}
      </span>

      <span
        className={`min-w-0 flex-1 truncate text-sm transition-transform duration-200 group-hover:translate-x-0.5 ${
          active ? "font-semibold text-foreground" : ""
        }`}
      >
        {label}
      </span>

      {/* Playhead — visible on active or hover */}
      <span
        aria-hidden
        className={`font-mono text-xs leading-none transition-all duration-200 ${
          active
            ? "translate-x-0 text-primary opacity-100"
            : "-translate-x-1 text-foreground/50 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
        }`}
      >
        ▸
      </span>
    </Link>
  );
}
