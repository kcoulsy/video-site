import { db } from "@video-site/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { ValidationError } from "../lib/errors";
import type { AppVariables } from "../types";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().positive().max(500).default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  sort: z.enum(["relevance", "date", "views"]).default("relevance"),
});

const suggestQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

interface SearchRow {
  id: string;
  title: string;
  description: string | null;
  duration: number | null;
  view_count: number;
  like_count: number;
  created_at: Date;
  thumbnail_path: string | null;
  tags: string[] | null;
  user_id: string;
  user_name: string;
  user_image: string | null;
  rank: number;
  title_similarity: number;
  description_snippet: string;
  total_count: string | number;
}

interface SuggestRow {
  title: string;
}

export const searchRoutes = new Hono<{ Variables: AppVariables }>();

searchRoutes.get("/", async (c) => {
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const rawQ = typeof params.q === "string" ? params.q.trim() : "";
  if (!rawQ) {
    return c.json({ results: [], total: 0, page: 1, totalPages: 0, query: "" });
  }

  const parsed = searchQuerySchema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  }
  const { q, page, limit, sort } = parsed.data;
  const offset = (page - 1) * limit;

  const orderBy =
    sort === "relevance"
      ? sql`rank DESC, title_similarity DESC`
      : sort === "date"
        ? sql`v.created_at DESC`
        : sql`v.view_count DESC`;

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
      u.id AS user_id,
      u.name AS user_name,
      u.image AS user_image,
      ts_rank_cd(v.search_vector, websearch_to_tsquery('english', ${q})) AS rank,
      similarity(v.title, ${q}) AS title_similarity,
      ts_headline(
        'english',
        coalesce(v.description, ''),
        websearch_to_tsquery('english', ${q}),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2'
      ) AS description_snippet,
      COUNT(*) OVER() AS total_count
    FROM video v
    JOIN "user" u ON v.user_id = u.id
    WHERE
      v.status = 'ready'
      AND v.visibility = 'public'
      AND v.deleted_at IS NULL
      AND u.banned_at IS NULL
      AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
      AND (
        v.search_vector @@ websearch_to_tsquery('english', ${q})
        OR similarity(v.title, ${q}) > 0.1
      )
    ORDER BY ${orderBy}
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const rows = results.rows as unknown as SearchRow[];
  const total = Number(rows[0]?.total_count ?? 0);

  return c.json({
    results: rows.map((row) => ({
      id: row.id,
      title: row.title,
      descriptionSnippet: row.description_snippet,
      duration: row.duration,
      viewCount: row.view_count,
      likeCount: row.like_count,
      createdAt: row.created_at,
      thumbnailUrl: row.thumbnail_path ? `/api/stream/${row.id}/thumbnail` : null,
      tags: row.tags ?? [],
      user: {
        id: row.user_id,
        name: row.user_name,
        image: row.user_image,
      },
      relevanceScore: Number(row.rank),
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    query: q,
  });
});

searchRoutes.get("/suggest", async (c) => {
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const rawQ = typeof params.q === "string" ? params.q.trim() : "";
  if (rawQ.length < 2) {
    return c.json({ suggestions: [] });
  }

  const parsed = suggestQuerySchema.safeParse({ q: rawQ });
  if (!parsed.success) {
    return c.json({ suggestions: [] });
  }
  const { q } = parsed.data;
  const prefix = `${q}%`;

  const results = await db.execute(sql`
    SELECT DISTINCT v.title AS title
    FROM video v
    JOIN "user" u ON v.user_id = u.id
    WHERE
      v.status = 'ready'
      AND v.visibility = 'public'
      AND v.deleted_at IS NULL
      AND u.banned_at IS NULL
      AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
      AND (
        v.title % ${q}
        OR v.title ILIKE ${prefix}
      )
    ORDER BY similarity(v.title, ${q}) DESC
    LIMIT 10
  `);

  const rows = results.rows as unknown as SuggestRow[];
  return c.json({ suggestions: rows.map((row) => row.title) });
});
