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
import { MAX_INPUT_DIMENSION, MAX_INPUT_PIXELS, THUMBNAIL_WIDTHS } from "./transcode";

const storage = createLocalStorage(env.STORAGE_PATH);

export async function processThumbnail(job: Job<ThumbnailJobData>) {
  const { videoId, thumbnailSourcePath } = job.data;

  const data = await Bun.file(thumbnailSourcePath).arrayBuffer();
  const savedPath = await storage.saveThumbnail(videoId, Buffer.from(data), "thumbnail-custom.jpg");

  // Generate WebP variants alongside the JPEG so the streaming route can serve them.
  // A sharp failure here propagates so BullMQ retries — a JPEG-only thumbnail is a
  // degraded result we don't want silently shipping to clients.
  const dir = path.posix.dirname(savedPath);
  const base = path.posix.basename(savedPath, path.posix.extname(savedPath));
  const input = sharp(savedPath, { limitInputPixels: MAX_INPUT_PIXELS }).timeout({ seconds: 30 });
  const meta = await input.metadata();
  if (
    (meta.width ?? 0) > MAX_INPUT_DIMENSION ||
    (meta.height ?? 0) > MAX_INPUT_DIMENSION
  ) {
    throw new Error(
      `thumbnail source ${meta.width}x${meta.height} exceeds ${MAX_INPUT_DIMENSION}px cap`,
    );
  }
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

  await db.update(video).set({ thumbnailPath: savedPath }).where(eq(video.id, videoId));
  await connection.del(`stream:meta:${videoId}`);

  await storage.deleteFile(thumbnailSourcePath).catch(() => {
    // best-effort cleanup
  });
}
