import { auth } from "@video-site/auth";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { ValidationError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import {
  getContinueWatching,
  getHomeFeed,
  getRelated,
  getTrending,
} from "../services/recommendations";
import type { AppVariables } from "../types";

const limitSchema = z.coerce.number().int().positive().max(50).default(20);

function parseLimit(c: Context): number {
  const raw = new URL(c.req.url).searchParams.get("limit");
  const parsed = limitSchema.safeParse(raw ?? undefined);
  if (!parsed.success) throw new ValidationError("Invalid limit");
  return parsed.data;
}

export const recommendationsRoutes = new Hono<{ Variables: AppVariables }>();

recommendationsRoutes.get("/recommendations/feed", async (c) => {
  const limit = parseLimit(c);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const items = await getHomeFeed(session?.user.id ?? null, limit);
  return c.json({ items });
});

recommendationsRoutes.get("/recommendations/trending", async (c) => {
  const items = await getTrending(parseLimit(c));
  return c.json({ items });
});

recommendationsRoutes.get("/recommendations/continue-watching", requireAuth, async (c) => {
  const items = await getContinueWatching(c.get("user").id, parseLimit(c));
  return c.json({ items });
});

recommendationsRoutes.get("/videos/:id/related", async (c) => {
  const items = await getRelated(c.req.param("id"), parseLimit(c));
  return c.json({ items });
});
