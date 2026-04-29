import { db } from "@video-site/db";
import { hiddenVideo } from "@video-site/db/schema/hidden-video";
import { video } from "@video-site/db/schema/video";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { NotFoundError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import type { AppVariables } from "../types";

export const hiddenVideoRoutes = new Hono<{ Variables: AppVariables }>();

hiddenVideoRoutes.post(
  "/hidden-videos/:videoId",
  requireAuth,
  rateLimit({ name: "hidden-add", limit: 60, windowSeconds: 60 }),
  async (c) => {
    const userId = c.get("user").id;
    const videoId = c.req.param("videoId");

    const [v] = await db
      .select({ id: video.id })
      .from(video)
      .where(eq(video.id, videoId))
      .limit(1);
    if (!v) {
      throw new NotFoundError("Video");
    }

    await db
      .insert(hiddenVideo)
      .values({ userId, videoId })
      .onConflictDoNothing({ target: [hiddenVideo.userId, hiddenVideo.videoId] });

    return c.json({ hidden: true });
  },
);

hiddenVideoRoutes.delete("/hidden-videos/:videoId", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");
  await db
    .delete(hiddenVideo)
    .where(and(eq(hiddenVideo.userId, userId), eq(hiddenVideo.videoId, videoId)));
  return c.json({ hidden: false });
});
