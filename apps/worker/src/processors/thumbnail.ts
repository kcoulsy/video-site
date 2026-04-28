import path from "node:path";

import { db } from "@video-site/db";
import { video } from "@video-site/db/schema/video";
import { env } from "@video-site/env/worker";
import { createLocalStorage } from "@video-site/storage";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import sharp from "sharp";

import { connection } from "../queues";
import type { ThumbnailJobData } from "../types";
import { THUMBNAIL_WIDTHS } from "./transcode";

const storage = createLocalStorage(env.STORAGE_PATH);

export async function processThumbnail(job: Job<ThumbnailJobData>) {
  const { videoId, thumbnailSourcePath } = job.data;

  const data = await Bun.file(thumbnailSourcePath).arrayBuffer();
  const savedPath = await storage.saveThumbnail(videoId, Buffer.from(data), "thumbnail-custom.jpg");

  // Generate WebP variants alongside the JPEG so the streaming route can serve them.
  try {
    const dir = path.posix.dirname(savedPath);
    const base = path.posix.basename(savedPath, path.posix.extname(savedPath));
    const input = sharp(savedPath);
    await Promise.all(
      THUMBNAIL_WIDTHS.map(async (w) => {
        const out = path.posix.join(dir, `${base}-${w}.webp`);
        await input
          .clone()
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: 78, effort: 4 })
          .toFile(out);
      }),
    );
  } catch (err) {
    console.error(`[thumbnail ${videoId}] webp variant generation failed:`, err);
  }

  await db.update(video).set({ thumbnailPath: savedPath }).where(eq(video.id, videoId));
  await connection.del(`stream:meta:${videoId}`);

  await storage.deleteFile(thumbnailSourcePath).catch(() => {
    // best-effort cleanup
  });
}
