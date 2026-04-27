import { db } from "@video-site/db";
import { video } from "@video-site/db/schema/video";
import { env } from "@video-site/env/worker";
import { createLocalStorage } from "@video-site/storage";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";

import { connection } from "../queues";
import type { ThumbnailJobData } from "../types";

const storage = createLocalStorage(env.STORAGE_PATH);

export async function processThumbnail(job: Job<ThumbnailJobData>) {
  const { videoId, thumbnailSourcePath } = job.data;

  const data = await Bun.file(thumbnailSourcePath).arrayBuffer();
  const savedPath = await storage.saveThumbnail(videoId, Buffer.from(data), "thumbnail-custom.jpg");

  await db.update(video).set({ thumbnailPath: savedPath }).where(eq(video.id, videoId));
  await connection.del(`stream:meta:${videoId}`);

  await storage.deleteFile(thumbnailSourcePath).catch(() => {
    // best-effort cleanup
  });
}
