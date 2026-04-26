import { db } from "@video-site/db";
import { category, categoryTag, tag } from "@video-site/db/schema/tags";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppVariables } from "../types";

export const tagRoutes = new Hono<{ Variables: AppVariables }>();

tagRoutes.get("/tags", async (c) => {
  const items = await db
    .select({ id: tag.id, slug: tag.slug, name: tag.name })
    .from(tag)
    .orderBy(asc(tag.name));
  return c.json({ items });
});

tagRoutes.get("/categories", async (c) => {
  const categories = await db
    .select({
      id: category.id,
      slug: category.slug,
      name: category.name,
      mode: category.mode,
      sortOrder: category.sortOrder,
    })
    .from(category)
    .orderBy(asc(category.sortOrder), asc(category.name));

  if (categories.length === 0) {
    return c.json({ items: [] });
  }

  const links = await db
    .select({
      categoryId: categoryTag.categoryId,
      tagId: tag.id,
      tagSlug: tag.slug,
      tagName: tag.name,
    })
    .from(categoryTag)
    .innerJoin(tag, eq(tag.id, categoryTag.tagId));

  const tagsByCategory = new Map<string, { id: string; slug: string; name: string }[]>();
  for (const link of links) {
    const list = tagsByCategory.get(link.categoryId) ?? [];
    list.push({ id: link.tagId, slug: link.tagSlug, name: link.tagName });
    tagsByCategory.set(link.categoryId, list);
  }

  const items = categories.map((cat) => ({
    ...cat,
    tags: tagsByCategory.get(cat.id) ?? [],
  }));

  return c.json({ items });
});
