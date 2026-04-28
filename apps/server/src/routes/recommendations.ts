import { auth } from "@video-site/auth";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { ValidationError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import {
  countTrendingCandidates,
  getContinueWatching,
  getHomeFeed,
  getRelated,
  getTrendingPage,
} from "../services/recommendations";
import type { AppVariables } from "../types";

const limitSchema = z.coerce.number().int().positive().max(50).default(20);
const pageSchema = z.coerce.number().int().positive().default(1);

function parseLimit(c: Context): number {
  const raw = new URL(c.req.url).searchParams.get("limit");
  const parsed = limitSchema.safeParse(raw ?? undefined);
  if (!parsed.success) throw new ValidationError("Invalid limit");
  return parsed.data;
}

function parsePage(c: Context): number {
  const raw = new URL(c.req.url).searchParams.get("page");
  const parsed = pageSchema.safeParse(raw ?? undefined);
  if (!parsed.success) throw new ValidationError("Invalid page");
  return parsed.data;
}

export const recommendationsRoutes = new Hono<{ Variables: AppVariables }>();

recommendationsRoutes.get("/recommendations/feed", async (c) => {
  const limit = parseLimit(c);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const items = await getHomeFeed(session?.user.id ?? null, limit);
  c.header("Cache-Control", "private, max-age=30");
  return c.json({ items });
});

recommendationsRoutes.get("/recommendations/trending", async (c) => {
  const limit = parseLimit(c);
  const page = parsePage(c);
  const [items, total] = await Promise.all([
    getTrendingPage(limit, (page - 1) * limit),
    countTrendingCandidates(),
  ]);
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ items, page, limit, total, totalPages });
});

recommendationsRoutes.get("/recommendations/continue-watching", requireAuth, async (c) => {
  const items = await getContinueWatching(c.get("user").id, parseLimit(c));
  c.header("Cache-Control", "private, no-store");
  return c.json({ items });
});

recommendationsRoutes.get("/videos/:id/related", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const items = await getRelated(c.req.param("id"), parseLimit(c), session?.user.id ?? null);
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ items });
});
