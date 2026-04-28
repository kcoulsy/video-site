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
  type: z.enum(["videos", "playlists", "all"]).default("all"),
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

interface VideoSuggestRow {
  title: string;
}

interface NamedSuggestRow {
  name: string;
}

export const searchRoutes = new Hono<{ Variables: AppVariables }>();

interface PlaylistSearchRow {
  id: string;
  title: string;
  description: string | null;
  updated_at: Date;
  item_count: number;
  thumb_video_id: string | null;
  user_id: string;
  user_name: string;
  user_handle: string | null;
  user_image: string | null;
  total_count: string | number;
}

searchRoutes.get("/", async (c) => {
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const rawQ = typeof params.q === "string" ? params.q.trim() : "";
  if (!rawQ) {
    return c.json({
      results: [],
      playlists: [],
      total: 0,
      playlistTotal: 0,
      page: 1,
      totalPages: 0,
      query: "",
    });
  }

  const parsed = searchQuerySchema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  }
  const { q, page, limit, sort, type } = parsed.data;
  const offset = (page - 1) * limit;

  const orderBy =
    sort === "relevance"
      ? sql`rank DESC, title_similarity DESC`
      : sort === "date"
        ? sql`v.created_at DESC`
        : sql`v.view_count DESC`;

  const wantVideos = type !== "playlists";
  const wantPlaylists = type !== "videos";

  const playlistPromise = wantPlaylists
    ? db.execute(sql`
        SELECT
          p.id,
          p.title,
          p.description,
          p.updated_at,
          (SELECT COUNT(*)::int FROM playlist_item pi WHERE pi.playlist_id = p.id) AS item_count,
          (SELECT pi.video_id FROM playlist_item pi WHERE pi.playlist_id = p.id ORDER BY pi.position ASC LIMIT 1) AS thumb_video_id,
          u.id AS user_id,
          u.name AS user_name,
          u.handle AS user_handle,
          u.image AS user_image,
          COUNT(*) OVER() AS total_count
        FROM playlist p
        JOIN "user" u ON u.id = p.user_id
        WHERE
          p.visibility = 'public'
          AND u.banned_at IS NULL
          AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
          AND (p.title ILIKE ${"%" + q + "%"} OR p.description ILIKE ${"%" + q + "%"})
        ORDER BY p.updated_at DESC
        LIMIT 20
      `)
    : Promise.resolve({ rows: [] as unknown as PlaylistSearchRow[] });

  const videoPromise = wantVideos
    ? db.execute(sql`
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
        OR EXISTS (
          SELECT 1 FROM video_tag vt
          JOIN tag t ON t.id = vt.tag_id
          WHERE vt.video_id = v.id AND lower(t.name) = lower(${q})
        )
        OR EXISTS (
          SELECT 1 FROM video_tag vt
          JOIN category_tag ct ON ct.tag_id = vt.tag_id
          JOIN category c ON c.id = ct.category_id
          WHERE vt.video_id = v.id AND lower(c.name) = lower(${q})
        )
      )
    ORDER BY ${orderBy}
    LIMIT ${limit}
    OFFSET ${offset}
  `)
    : Promise.resolve({ rows: [] as unknown as SearchRow[] });

  const [results, playlistResults] = await Promise.all([videoPromise, playlistPromise]);

  const rows = results.rows as unknown as SearchRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  const pRows = playlistResults.rows as unknown as PlaylistSearchRow[];
  const playlistTotal = Number(pRows[0]?.total_count ?? 0);

  c.header("Cache-Control", "public, max-age=30");
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
    playlists: pRows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      updatedAt: row.updated_at,
      itemCount: row.item_count,
      thumbnailUrl: row.thumb_video_id ? `/api/stream/${row.thumb_video_id}/thumbnail` : null,
      user: {
        id: row.user_id,
        name: row.user_name,
        handle: row.user_handle,
        image: row.user_image,
      },
    })),
    total,
    playlistTotal,
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

  const [videoResults, tagResults, categoryResults] = await Promise.all([
    db.execute(sql`
      SELECT v.title AS title
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
      GROUP BY v.title
      ORDER BY MAX(similarity(v.title, ${q})) DESC
      LIMIT 6
    `),
    db.execute(sql`
      SELECT t.name AS name
      FROM tag t
      WHERE t.name % ${q} OR t.name ILIKE ${prefix}
      ORDER BY similarity(t.name, ${q}) DESC
      LIMIT 4
    `),
    db.execute(sql`
      SELECT c.name AS name
      FROM category c
      WHERE c.name % ${q} OR c.name ILIKE ${prefix}
      ORDER BY similarity(c.name, ${q}) DESC
      LIMIT 3
    `),
  ]);

  const videoRows = videoResults.rows as unknown as VideoSuggestRow[];
  const tagRows = tagResults.rows as unknown as NamedSuggestRow[];
  const categoryRows = categoryResults.rows as unknown as NamedSuggestRow[];

  const suggestions = [
    ...categoryRows.map((row) => ({ type: "category" as const, label: row.name })),
    ...tagRows.map((row) => ({ type: "tag" as const, label: row.name })),
    ...videoRows.map((row) => ({ type: "video" as const, label: row.title })),
  ];

  c.header("Cache-Control", "public, max-age=120");
  return c.json({ suggestions });
});
