# Phase 7: Search

## Overview

Implement PostgreSQL full-text search using `pg_trgm` and `tsvector` for searching videos by title, description, and tags. Build the search API with autocomplete suggestions, and a frontend search UI with highlighted results.

## Prerequisites

- Phase 4 complete (videos exist with titles, descriptions, and tags)
- PostgreSQL running with the `pg_trgm` extension available (included by default in PostgreSQL 16)

---

## 1. Database Migration: Full-Text Search Setup

### File: `packages/db/src/migrations/xxxx_search_vector.sql` (new)

Drizzle ORM doesn't natively support `tsvector` columns, `GENERATED ALWAYS AS` columns, or GIN indexes with operator classes. This must be done as a raw SQL migration.

```sql
-- Enable the pg_trgm extension for fuzzy/typo-tolerant matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add a generated tsvector column to the video table
-- This column auto-updates whenever title, description, or tags change
ALTER TABLE video ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C')
  ) STORED;

-- GIN index on the search vector for fast full-text queries
CREATE INDEX IF NOT EXISTS video_search_idx ON video USING GIN (search_vector);

-- Trigram GIN index on the title for fuzzy matching (typo tolerance)
CREATE INDEX IF NOT EXISTS video_title_trgm_idx ON video USING GIN (title gin_trgm_ops);
```

### How to run this migration

Option A: Place the SQL file in the Drizzle migrations directory and run it alongside Drizzle migrations.

Option B: Run it manually or via a script:

```
psql $DATABASE_URL -f packages/db/src/migrations/xxxx_search_vector.sql
```

Option C: Add a custom migration script in `package.json`:

```json
"db:search-migration": "psql $DATABASE_URL -f packages/db/src/migrations/xxxx_search_vector.sql"
```

### Key design choices

- **`GENERATED ALWAYS AS ... STORED`**: The `search_vector` column is automatically computed and stored. It updates whenever `title`, `description`, or `tags` change — no manual index maintenance needed.
- **Weighted fields**: `'A'` weight for title (most important), `'B'` for description, `'C'` for tags. PostgreSQL's `ts_rank_cd` uses these weights for relevance scoring.
- **`pg_trgm` for fuzzy matching**: Handles typos like "cokking" matching "cooking". Trigram similarity computes a 0-1 score based on shared 3-character sequences.
- **GIN indexes**: Optimized for set-containment queries (`@@` for tsvector, `%` for trigram). Fast reads, slightly slower writes — fine for a video site where reads vastly outnumber writes.

---

## 2. Search API

### File: `apps/server/src/routes/search.ts` (new)

Mounted at `/api/search` in the main app.

### `GET /api/search?q=<query>&page=1&limit=20&sort=relevance`

Main search endpoint.

**Query params**:

- `q`: search query (required, 1-200 chars)
- `page`: page number (default 1)
- `limit`: results per page (default 20, max 50)
- `sort`: "relevance" (default) | "date" | "views"

**Empty/missing `q`**: Return empty results or redirect to home.

**Implementation using raw SQL via Drizzle's `sql` template**:

```typescript
import { sql } from "drizzle-orm";

app.get("/", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q || q.length === 0) {
    return c.json({ results: [], total: 0, page: 1, totalPages: 0 });
  }

  const page = Math.max(1, parseInt(c.req.query("page") ?? "1"));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") ?? "20")));
  const sort = c.req.query("sort") ?? "relevance";
  const offset = (page - 1) * limit;

  // Build the search query
  const results = await db.execute(sql`
    SELECT
      v.id,
      v.title,
      v.description,
      v.duration,
      v.view_count,
      v.like_count,
      v.created_at,
      v.thumbnail_path,
      v.tags,
      u.id as user_id,
      u.name as user_name,
      u.image as user_image,
      ts_rank_cd(v.search_vector, websearch_to_tsquery('english', ${q})) AS rank,
      similarity(v.title, ${q}) AS title_similarity,
      ts_headline(
        'english',
        v.description,
        websearch_to_tsquery('english', ${q}),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2'
      ) AS description_snippet,
      COUNT(*) OVER() AS total_count
    FROM video v
    JOIN "user" u ON v.user_id = u.id
    WHERE
      v.status = 'ready'
      AND v.visibility = 'public'
      AND (
        v.search_vector @@ websearch_to_tsquery('english', ${q})
        OR similarity(v.title, ${q}) > 0.1
      )
    ORDER BY
      ${
        sort === "relevance"
          ? sql`rank DESC, title_similarity DESC`
          : sort === "date"
            ? sql`v.created_at DESC`
            : sql`v.view_count DESC`
      }
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  // Total count is included in each row via window function — no second query needed.
  // (Running the same complex WHERE clause twice is expensive; COUNT(*) OVER() is free.)
  const total = Number(results.rows[0]?.total_count ?? 0);

  return c.json({
    results: results.rows.map((row) => ({
      id: row.id,
      title: row.title,
      descriptionSnippet: row.description_snippet, // HTML with <mark> tags
      duration: row.duration,
      viewCount: row.view_count,
      likeCount: row.like_count,
      createdAt: row.created_at,
      thumbnailUrl: row.thumbnail_path ? `/api/stream/${row.id}/thumbnail` : null,
      tags: row.tags,
      user: {
        id: row.user_id,
        name: row.user_name,
        image: row.user_image,
      },
      relevanceScore: row.rank,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    query: q,
  });
});
```

### Key SQL functions used

- **`websearch_to_tsquery('english', query)`**: Parses a natural language search query. Supports:
  - `cooking recipes` -> AND both terms
  - `"pasta sauce"` -> exact phrase
  - `cooking OR baking` -> OR
  - `-vegan` -> NOT
  - Much more user-friendly than `plainto_tsquery` or `to_tsquery`

- **`ts_rank_cd(vector, query)`**: Computes relevance score considering cover density (proximity of matched terms). Higher = more relevant.

- **`similarity(text, text)`**: From `pg_trgm`. Returns a 0-1 score for trigram similarity. 0.1 threshold catches fuzzy matches while filtering noise.

- **`ts_headline(config, text, query, options)`**: Generates text snippets with highlighted matching terms. Options:
  - `StartSel=<mark>, StopSel=</mark>` — wraps matches in `<mark>` tags
  - `MaxWords=35, MinWords=15` — snippet length bounds
  - `MaxFragments=2` — up to 2 separate fragments

### `GET /api/search/suggest?q=<partial>`

Autocomplete suggestions for the search bar.

**Query params**:

- `q`: partial query (minimum 2 characters)

**Response**:

```json
{
  "suggestions": ["Cooking with Fire", "Cooking Basics 101", "Cookie Decorating Tutorial"]
}
```

**Implementation**:

```typescript
app.get("/suggest", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q || q.length < 2) {
    return c.json({ suggestions: [] });
  }

  // Use the trigram % operator (which uses the GIN index) instead of
  // ILIKE '%q%' (which does a full table scan due to the leading wildcard).
  // Also add a prefix match as fallback for exact substring matches
  // that score low on trigram similarity.
  const results = await db.execute(sql`
    SELECT DISTINCT title
    FROM video
    WHERE
      status = 'ready'
      AND visibility = 'public'
      AND (
        title % ${q}
        OR title ILIKE ${q + "%"}
      )
    ORDER BY similarity(title, ${q}) DESC
    LIMIT 10
  `);

  return c.json({
    suggestions: results.rows.map((row) => row.title),
  });
});
```

The `title % ${q}` operator uses the GIN trigram index for fast fuzzy matching. The `ILIKE ${q + '%'}` fallback (trailing wildcard only, no leading wildcard) catches prefix matches like "cook" matching "Cooking" and can use a B-tree index. Avoid `ILIKE '%q%'` (leading wildcard) as it forces a full table scan.

---

## 3. Frontend: Search Bar

### File: `apps/web/src/components/search-bar.tsx` (new)

Search input placed in the header, between navigation and user menu.

**Layout**:

```
+-------------------------------------------+
| [Search icon] [Search videos...] [X]      |
+-------------------------------------------+
| Suggestion 1                              |  <- dropdown
| Suggestion 2                              |
| Suggestion 3                              |
+-------------------------------------------+
```

**Behavior**:

- Text input with a search icon (Lucide `Search`)
- Clear button (X) appears when text is present
- **Keyboard shortcut**: Press `/` to focus the search bar (YouTube-style). Add a global `keydown` listener that focuses the input when `/` is pressed and the input isn't already focused and no other input is focused.
- **Debounced autocomplete**: On input change, debounce 300ms, then fetch `GET /api/search/suggest?q=<value>`. Show suggestions in a dropdown below the input.
- **Suggestion selection**: Click or arrow-key + Enter to select a suggestion. Populates the input and triggers search.
- **Search execution**: On Enter or form submit, navigate to `/search?q=<value>`. Use TanStack Router's `useNavigate`:
  ```typescript
  const navigate = useNavigate();
  navigate({ to: "/search", search: { q: value } });
  ```
- **Dropdown dismissal**: Close suggestions on blur, Escape key, or navigation.

**Debounce implementation**:

```typescript
const [inputValue, setInputValue] = useState("");
const [suggestions, setSuggestions] = useState<string[]>([]);
const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

function handleInputChange(value: string) {
  setInputValue(value);

  clearTimeout(debounceTimer.current);
  if (value.length < 2) {
    setSuggestions([]);
    return;
  }

  debounceTimer.current = setTimeout(async () => {
    const data = await apiClient<{ suggestions: string[] }>(
      `/api/search/suggest?q=${encodeURIComponent(value)}`,
    );
    setSuggestions(data.suggestions);
  }, 300);
}
```

---

## 4. Frontend: Search Results Page

### File: `apps/web/src/routes/search.tsx` (new)

URL: `/search?q=<query>&sort=relevance&page=1`

Route definition:

```typescript
import { createFileRoute } from "@tanstack/react-router";

// Use TanStack Router's search params validation
const searchParamsSchema = z.object({
  q: z.string().default(""),
  sort: z.enum(["relevance", "date", "views"]).default("relevance"),
  page: z.coerce.number().default(1),
});

export const Route = createFileRoute("/search")({
  component: SearchPage,
  validateSearch: searchParamsSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (!deps.q) return { results: [], total: 0, page: 1, totalPages: 0, query: "" };
    // Fetch from GET /api/search?q=...&sort=...&page=...
  },
});
```

**Page layout**:

```
+--------------------------------------------------+
| About 42 results for "cooking" (0.12s)           |
| Sort: [Relevance v] [Upload Date] [View Count]   |
+--------------------------------------------------+
| [SearchResultItem]                                |
| [SearchResultItem]                                |
| [SearchResultItem]                                |
+--------------------------------------------------+
| [< Prev] Page 1 of 3 [Next >]                    |
+--------------------------------------------------+
```

**No results state**:

```
+--------------------------------------------------+
| No results found for "xyzabc123"                 |
|                                                   |
| Try different keywords or check your spelling     |
+--------------------------------------------------+
```

**Features**:

- Search query displayed in the search bar (populated from URL params)
- Result count + query echo
- Sort controls: three buttons/tabs for relevance, date, views. Active sort is highlighted. Clicking changes the URL param and refetches.
- **Pagination**: Previous/Next buttons with page numbers. Update URL `page` param on click. Or use infinite scroll with "Load more" button.
- **URL state**: All state (query, sort, page) lives in URL search params. Results are shareable. Back button works correctly.

---

## 5. Frontend: Search Result Item

### File: `apps/web/src/components/search-result-item.tsx` (new)

Horizontal layout, different from the vertical `VideoCard` used in grids.

**Layout**:

```
+-------+----------------------------------------+
|       | Title of the Video                     |
| Thumb | 1.2K views · 3 days ago                |
| nail  | Uploader Name                          |
|       | ...matching text with <mark>highlighted |
|       | keywords</mark> in the description...   |
+-------+----------------------------------------+
```

Props:

```typescript
interface SearchResultItemProps {
  id: string;
  title: string;
  descriptionSnippet: string; // HTML string with <mark> tags
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: string;
  user: { name: string; image?: string | null };
  tags?: string[];
}
```

Implementation:

- Thumbnail on the left: fixed width (~240px desktop, ~120px mobile), aspect-ratio 16:9, with duration overlay
- Metadata on the right: title (bold, `line-clamp-2`), view count + relative time, uploader name
- **Description snippet**: Render with `dangerouslySetInnerHTML` for the `<mark>` tags from `ts_headline`. **Important**: The snippet comes from PostgreSQL's `ts_headline` which only adds `<mark>` tags to the server-provided description text — it does NOT pass through user HTML. This is safe because the description is stored as plain text (HTML is stripped on input in the comment/video API). However, as a defense-in-depth measure, you could sanitize the snippet to only allow `<mark>` tags:
  ```typescript
  function sanitizeSnippet(html: string): string {
    return html.replace(/<(?!\/?mark\b)[^>]*>/gi, "");
  }
  ```
- Tags: If present, show as small badges/chips below the snippet
- Entire item is a `<Link to="/watch/$id">`
- Responsive: on mobile, stack thumbnail above metadata instead of side-by-side

---

## 6. Header Update

### File: `apps/web/src/components/header.tsx` (modify)

Add the `SearchBar` component in the center of the header:

```
[Logo/Home] [Dashboard] [Upload]  [====SearchBar====]  [UserMenu]
```

The search bar should take up flexible space in the center. Use flexbox:

```typescript
<header className="flex items-center gap-4 px-4 py-2">
  <nav className="flex items-center gap-2">
    {/* Logo, nav links */}
  </nav>
  <div className="flex-1 max-w-xl mx-auto">
    <SearchBar />
  </div>
  <div className="flex items-center gap-2">
    {/* Upload button, UserMenu */}
  </div>
</header>
```

---

## 7. Route Mounting

### File: `apps/server/src/index.ts` (modify)

```typescript
import searchRoutes from "./routes/search";
app.route("/api/search", searchRoutes);
```

---

## Verification Checklist

1. **Basic search**: Search "cooking" -> finds videos with "cooking" in title, description, or tags
2. **Weighted ranking**: A video with "cooking" in the title ranks higher than one with "cooking" only in the description
3. **Fuzzy matching**: Search "cokking" -> still finds "cooking" videos (trigram similarity)
4. **Phrase search**: Search `"pasta sauce"` (with quotes) -> only finds videos containing the exact phrase
5. **Sort by relevance**: Default sort returns most relevant results first
6. **Sort by date**: Returns newest videos first
7. **Sort by views**: Returns most-viewed videos first
8. **Autocomplete**: Typing "cook" shows suggestions like "Cooking Basics", "Cookie Tutorial"
9. **Autocomplete debounce**: Suggestions don't fire on every keystroke (300ms delay)
10. **Keyboard shortcut**: Press `/` anywhere on the page -> search bar focuses
11. **URL state**: Search results page URL contains `?q=cooking&sort=relevance&page=1`
12. **Shareable URLs**: Copy a search URL and open in new tab -> same results
13. **Pagination**: Navigate between pages of results
14. **Highlighted snippets**: Description snippets show matching terms in bold/highlighted
15. **No results**: Searching gibberish shows "No results found" with helpful text
16. **Empty query**: Empty search redirects to home or shows empty state
17. **Only ready+public**: Draft/private/processing videos do not appear in results
18. **Performance**: Searches return in < 200ms for a corpus of ~1000 videos (GIN indexes)

---

## Files Summary

| Action | File                                                 |
| ------ | ---------------------------------------------------- |
| Create | `packages/db/src/migrations/xxxx_search_vector.sql`  |
| Create | `apps/server/src/routes/search.ts`                   |
| Create | `apps/web/src/routes/search.tsx`                     |
| Create | `apps/web/src/components/search-bar.tsx`             |
| Create | `apps/web/src/components/search-result-item.tsx`     |
| Modify | `apps/server/src/index.ts` (mount search routes)     |
| Modify | `apps/web/src/components/header.tsx` (add SearchBar) |

## Dependencies to Install

None — all dependencies are already available from prior phases.

---

## Future Enhancements (out of scope)

- Search filters: duration range, upload date range, resolution
- Search history: remember recent searches per user
- Trending searches: show popular queries
- Search analytics: track what users search for
- Elasticsearch/Meilisearch: if PostgreSQL search becomes a bottleneck at scale
