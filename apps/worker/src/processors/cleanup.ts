import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { db } from "@video-site/db";
import { video } from "@video-site/db/schema/video";
import { env } from "@video-site/env/worker";
import { createLocalStorage } from "@video-site/storage";
import type { Job } from "bullmq";
import { and, eq, lt } from "drizzle-orm";

import type { CleanupJobData } from "../types";

const storage = createLocalStorage(env.STORAGE_PATH);

const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;
const FAILED_VIDEO_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function cleanupStaleUploads() {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_AGE_MS);

  const stale = await db
    .select({ id: video.id })
    .from(video)
    .where(and(eq(video.status, "uploading"), lt(video.createdAt, cutoff)));

  for (const row of stale) {
    await storage.deleteVideoFiles(row.id).catch((err) => {
      console.error(`[cleanup] failed to delete files for ${row.id}:`, err);
    });
    await db.delete(video).where(eq(video.id, row.id));
    console.log(`[cleanup] removed stale upload ${row.id}`);
  }

  const tusDir = storage.getTusDir();
  let entries: string[] = [];
  try {
    entries = await readdir(tusDir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = path.posix.join(tusDir, name);
    try {
      const s = await stat(full);
      if (s.mtimeMs < Date.now() - STALE_UPLOAD_AGE_MS) {
        await storage.deleteFile(full);
        console.log(`[cleanup] removed stale tus file ${name}`);
      }
    } catch {
      // ignore
    }
  }
}

async function cleanupFailedVideos() {
  const cutoff = new Date(Date.now() - FAILED_VIDEO_AGE_MS);

  const failed = await db
    .select({ id: video.id })
    .from(video)
    .where(and(eq(video.status, "failed"), lt(video.updatedAt, cutoff)));

  for (const row of failed) {
    await storage.deleteVideoFiles(row.id).catch((err) => {
      console.error(`[cleanup] failed to delete files for ${row.id}:`, err);
    });
    await db.delete(video).where(eq(video.id, row.id));
    console.log(`[cleanup] removed failed video ${row.id}`);
  }
}

async function deleteVideo(videoId: string) {
  try {
    await storage.deleteVideoFiles(videoId);
    console.log(`[cleanup] deleted video files ${videoId}`);
  } catch (err) {
    console.error(`[cleanup] failed to delete files for ${videoId}:`, err);
    throw err;
  }
}

export async function processCleanup(job: Job<CleanupJobData>) {
  const { type, videoId } = job.data;

  switch (type) {
    case "stale-uploads":
      await cleanupStaleUploads();
      break;
    case "failed-videos":
      await cleanupFailedVideos();
      break;
    case "delete-video":
      if (!videoId) throw new Error("videoId required for delete-video");
      await deleteVideo(videoId);
      break;
  }
}
