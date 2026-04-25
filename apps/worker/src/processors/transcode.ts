import path from "node:path";

import { db } from "@video-site/db";
import { video } from "@video-site/db/schema/video";
import { env } from "@video-site/env/worker";
import { createLocalStorage } from "@video-site/storage";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import ffmpeg from "fluent-ffmpeg";

import type { TranscodeJobData } from "../types";

ffmpeg.setFfmpegPath(env.FFMPEG_PATH);
ffmpeg.setFfprobePath(env.FFPROBE_PATH);

const storage = createLocalStorage(env.STORAGE_PATH);

const MAX_DURATION_SECONDS = 30 * 60;

interface Resolution {
  width: number;
  height: number;
  bitrate: string;
  profile: "main" | "high";
}

const RESOLUTION_LADDER: Resolution[] = [
  { width: 640, height: 360, bitrate: "800k", profile: "main" },
  { width: 1280, height: 720, bitrate: "2500k", profile: "main" },
  { width: 1920, height: 1080, bitrate: "5000k", profile: "high" },
];

function probe(filePath: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function extractThumbnail(
  inputPath: string,
  outputPath: string,
  timestampSeconds: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(timestampSeconds)
      .frames(1)
      .videoFilter("scale=640:-2")
      .outputOptions("-q:v", "2")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

function transcodeToDash(
  inputPath: string,
  outputDir: string,
  resolutions: Resolution[],
  hasAudio: boolean,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const manifestPath = path.posix.join(outputDir, "manifest.mpd");
    let cmd = ffmpeg(inputPath);

    for (let i = 0; i < resolutions.length; i++) {
      cmd = cmd.outputOptions("-map", "0:v");
    }
    if (hasAudio) {
      cmd = cmd.outputOptions("-map", "0:a?");
    }

    for (let i = 0; i < resolutions.length; i++) {
      const r = resolutions[i]!;
      cmd = cmd.outputOptions(
        `-c:v:${i}`,
        "libx264",
        `-b:v:${i}`,
        r.bitrate,
        `-filter:v:${i}`,
        `scale=${r.width}:-2`,
        `-profile:v:${i}`,
        r.profile,
        `-preset`,
        "veryfast",
      );
    }

    if (hasAudio) {
      cmd = cmd.outputOptions("-c:a", "aac", "-b:a", "128k", "-ar", "44100");
    }

    const adaptationSets = hasAudio ? "id=0,streams=v id=1,streams=a" : "id=0,streams=v";

    cmd = cmd.outputOptions(
      "-f",
      "dash",
      "-seg_duration",
      "4",
      "-use_template",
      "1",
      "-use_timeline",
      "1",
      "-init_seg_name",
      "init-stream$RepresentationID$.m4s",
      "-media_seg_name",
      "chunk-stream$RepresentationID$-$Number%05d$.m4s",
      "-adaptation_sets",
      adaptationSets,
    );

    cmd
      .output(manifestPath)
      .on("progress", (p) => {
        if (typeof p.percent === "number" && Number.isFinite(p.percent)) {
          onProgress(Math.max(0, Math.min(100, p.percent)));
        }
      })
      .on("end", () => resolve(manifestPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

export async function processTranscode(job: Job<TranscodeJobData>) {
  const { videoId, rawPath } = job.data;

  try {
    await db
      .update(video)
      .set({ status: "processing", processingError: null })
      .where(eq(video.id, videoId));

    await job.updateProgress({ stage: "probing", percent: 1 });

    const probed = await probe(rawPath);
    const videoStream = probed.streams.find((s) => s.codec_type === "video");
    const audioStream = probed.streams.find((s) => s.codec_type === "audio");

    if (!videoStream) {
      throw new Error("No video stream found in source");
    }

    const duration = Math.floor(probed.format.duration ?? 0);
    const sourceWidth = videoStream.width ?? 0;
    const sourceHeight = videoStream.height ?? 0;

    if (!duration || !sourceWidth || !sourceHeight) {
      throw new Error("Could not determine duration or resolution");
    }
    if (duration > MAX_DURATION_SECONDS) {
      throw new Error(`Video exceeds maximum duration of ${MAX_DURATION_SECONDS / 60} minutes`);
    }

    await db
      .update(video)
      .set({ duration, width: sourceWidth, height: sourceHeight })
      .where(eq(video.id, videoId));

    await job.updateProgress({ stage: "probing", percent: 5 });

    const thumbnailDir = storage.getThumbnailPath(videoId);
    const thumbnailFile = path.posix.join(thumbnailDir, "thumbnail.jpg");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(thumbnailDir, { recursive: true });
    await extractThumbnail(rawPath, thumbnailFile, duration * 0.25);

    await db.update(video).set({ thumbnailPath: thumbnailFile }).where(eq(video.id, videoId));

    await job.updateProgress({ stage: "thumbnail", percent: 10 });

    let targetResolutions = RESOLUTION_LADDER.filter((r) => r.height <= sourceHeight);
    if (targetResolutions.length === 0) {
      targetResolutions = [RESOLUTION_LADDER[0]!];
    }

    const transcodedDir = await storage.ensureTranscodedDir(videoId);
    const manifestPath = await transcodeToDash(
      rawPath,
      transcodedDir,
      targetResolutions,
      Boolean(audioStream),
      (ffmpegPercent) => {
        const overall = 10 + ffmpegPercent * 0.85;
        void job.updateProgress({ stage: "transcoding", percent: overall });
      },
    );

    await db
      .update(video)
      .set({
        status: "ready",
        manifestPath,
        publishedAt: new Date(),
        processingError: null,
      })
      .where(eq(video.id, videoId));

    if (env.DELETE_RAW_AFTER_TRANSCODE) {
      await storage.deleteFile(rawPath).catch(() => {
        // best-effort: don't fail the job if raw cleanup fails
      });
    }

    await job.updateProgress({ stage: "complete", percent: 100 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(video)
      .set({ status: "failed", processingError: message })
      .where(eq(video.id, videoId));
    throw err;
  }
}
