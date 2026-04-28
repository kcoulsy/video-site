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

function CategoryNav({ selected, onNavigate }: { selected?: string; onNavigate?: () => void }) {
  const { data, isLoading } = useQuery<CategoriesResponse>({
    queryKey: ["categories"],
    queryFn: () => apiClient<CategoriesResponse>("/api/categories"),
    staleTime: 5 * 60 * 1000,
  });

  const items = data?.items ?? [];
  const allActive = !selected;

  return (
    <>
      <div className="mb-3 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Categories
      </div>

      <nav className="flex flex-col">
        <ChapterLink
          label="All Videos"
          active={allActive}
          onNavigate={onNavigate}
          search={(prev: Record<string, unknown>) => ({
            ...prev,
            category: undefined,
            page: undefined,
          })}
        />

        {isLoading && items.length === 0 ? (
          <div className="mt-2 px-4 py-1.5 text-xs text-muted-foreground/60">Loading…</div>
        ) : null}

        {items.map((cat) => {
          const active = selected === cat.slug;
          return (
            <ChapterLink
              key={cat.id}
              label={cat.name}
              active={active}
              title={cat.tags.map((t) => t.name).join(cat.mode === "all" ? " AND " : " OR ")}
              onNavigate={onNavigate}
              search={(prev: Record<string, unknown>) => ({
                ...prev,
                category: active ? undefined : cat.slug,
                page: undefined,
              })}
            />
          );
        })}
      </nav>
    </>
  );
}

export function CategorySidebar({ selected }: CategorySidebarProps) {
  return (
    <aside className="hidden w-60 shrink-0 md:block">
      <div className="sticky top-20">
        <CategoryNav selected={selected} />
      </div>
    </aside>
  );
}

export function CategoryDrawerContent({
  selected,
  onNavigate,
}: {
  selected?: string;
  onNavigate?: () => void;
}) {
  return <CategoryNav selected={selected} onNavigate={onNavigate} />;
}

interface ChapterLinkProps {
  label: string;
  active: boolean;
  title?: string;
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
  onNavigate?: () => void;
}

function ChapterLink({ label, active, title, search, onNavigate }: ChapterLinkProps) {
  return (
    <Link
      to="/"
      search={search}
      title={title}
      onClick={onNavigate}
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
