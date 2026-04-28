import path from "node:path";

import { db } from "@video-site/db";
import { video } from "@video-site/db/schema/video";
import { env } from "@video-site/env/worker";
import { createLocalStorage } from "@video-site/storage";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import ffmpeg from "fluent-ffmpeg";

import { connection, notificationsQueue } from "../queues";
import type { TranscodeJobData } from "../types";

const STREAM_META_CACHE_KEY = (videoId: string) => `stream:meta:${videoId}`;

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

const MANIFEST_LADDER: Resolution[] = [
  { width: 640, height: 360, bitrate: "800k", profile: "main" },
  { width: 1280, height: 720, bitrate: "2500k", profile: "main" },
];

const EXTRA_RENDITION: Resolution = {
  width: 1920,
  height: 1080,
  bitrate: "5000k",
  profile: "high",
};

function probe(filePath: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// Attach uniform diagnostics: log start command and capture stderr tail so the
// rejection includes the actual reason ffmpeg gave us.
function attachDiagnostics(
  cmd: ffmpeg.FfmpegCommand,
  label: string,
): { stderrLines: string[] } {
  const stderrLines: string[] = [];
  cmd
    .on("start", (cmdline: string) => {
      console.log(`[${label}] ffmpeg start: ${cmdline}`);
    })
    .on("stderr", (line: string) => {
      stderrLines.push(line);
      if (stderrLines.length > 200) stderrLines.shift();
    });
  return { stderrLines };
}

function ffmpegError(err: Error, stderrLines: string[]): Error {
  const tail = stderrLines.slice(-30).join("\n");
  return new Error(`${err.message}\n--- ffmpeg stderr (last 30 lines) ---\n${tail}`);
}

function extractThumbnail(
  inputPath: string,
  outputPath: string,
  timestampSeconds: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath)
      .seekInput(timestampSeconds)
      .frames(1)
      .videoFilter("scale=640:-2")
      .outputOptions("-q:v", "2")
      .output(outputPath);
    const { stderrLines } = attachDiagnostics(cmd, "thumbnail");
    cmd.on("end", () => resolve()).on("error", (err: Error) => reject(ffmpegError(err, stderrLines))).run();
  });
}

const STORYBOARD_TILE_WIDTH = 160;
const STORYBOARD_TILE_HEIGHT = 90;
const STORYBOARD_MAX_TILES = 100;

interface StoryboardLayout {
  interval: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

function computeStoryboardLayout(durationSec: number): StoryboardLayout {
  const interval = Math.max(2, Math.ceil(durationSec / STORYBOARD_MAX_TILES));
  const tileCount = Math.max(1, Math.ceil(durationSec / interval));
  const cols = Math.min(10, Math.ceil(Math.sqrt(tileCount)));
  const rows = Math.max(1, Math.ceil(tileCount / cols));
  return {
    interval,
    cols,
    rows,
    tileWidth: STORYBOARD_TILE_WIDTH,
    tileHeight: STORYBOARD_TILE_HEIGHT,
  };
}

function generateStoryboard(
  inputPath: string,
  outputPath: string,
  layout: StoryboardLayout,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath)
      .outputOptions(
        "-vf",
        `fps=1/${layout.interval},scale=${layout.tileWidth}:${layout.tileHeight}:force_original_aspect_ratio=decrease,pad=${layout.tileWidth}:${layout.tileHeight}:(ow-iw)/2:(oh-ih)/2:black,tile=${layout.cols}x${layout.rows}`,
        "-frames:v",
        "1",
        "-q:v",
        "4",
      )
      .output(outputPath);
    const { stderrLines } = attachDiagnostics(cmd, "storyboard");
    cmd.on("end", () => resolve()).on("error", (err: Error) => reject(ffmpegError(err, stderrLines))).run();
  });
}

function transcodeToMp4(
  inputPath: string,
  outputPath: string,
  resolution: Resolution,
  hasAudio: boolean,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath).outputOptions(
      "-map",
      "0:v",
      "-c:v",
      "libx264",
      "-b:v",
      resolution.bitrate,
      "-vf",
      `scale=${resolution.width}:-2`,
      "-profile:v",
      resolution.profile,
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
    );

    if (hasAudio) {
      cmd = cmd.outputOptions("-map", "0:a?", "-c:a", "aac", "-b:a", "128k", "-ar", "44100");
    }

    cmd.output(outputPath);
    const { stderrLines } = attachDiagnostics(cmd, "transcode-mp4");
    cmd
      .on("progress", (p) => {
        if (typeof p.percent === "number" && Number.isFinite(p.percent)) {
          onProgress(Math.max(0, Math.min(100, p.percent)));
        }
      })
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(ffmpegError(err, stderrLines)))
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

    cmd.output(manifestPath);
    const { stderrLines } = attachDiagnostics(cmd, "transcode-dash");
    cmd
      .on("progress", (p) => {
        if (typeof p.percent === "number" && Number.isFinite(p.percent)) {
          onProgress(Math.max(0, Math.min(100, p.percent)));
        }
      })
      .on("end", () => resolve(manifestPath))
      .on("error", (err: Error) => reject(ffmpegError(err, stderrLines)))
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
    const { mkdir } = await import("node:fs/promises");
    await mkdir(thumbnailDir, { recursive: true });

    const STILL_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];
    const stillFiles = STILL_FRACTIONS.map((_, i) =>
      path.posix.join(thumbnailDir, `still-${i}.jpg`),
    );
    for (let i = 0; i < STILL_FRACTIONS.length; i++) {
      await extractThumbnail(rawPath, stillFiles[i]!, duration * STILL_FRACTIONS[i]!);
    }

    const defaultStillIndex = 1;
    await db
      .update(video)
      .set({
        thumbnailPath: stillFiles[defaultStillIndex]!,
        thumbnailStillsCount: STILL_FRACTIONS.length,
        thumbnailStillIndex: defaultStillIndex,
      })
      .where(eq(video.id, videoId));

    const storyboardLayout = computeStoryboardLayout(duration);
    const storyboardPath = path.posix.join(thumbnailDir, "storyboard.jpg");
    try {
      await generateStoryboard(rawPath, storyboardPath, storyboardLayout);
      await db
        .update(video)
        .set({
          storyboardPath,
          storyboardInterval: storyboardLayout.interval,
          storyboardCols: storyboardLayout.cols,
          storyboardRows: storyboardLayout.rows,
          storyboardTileWidth: storyboardLayout.tileWidth,
          storyboardTileHeight: storyboardLayout.tileHeight,
        })
        .where(eq(video.id, videoId));
    } catch (err) {
      console.error(`[transcode ${videoId}] storyboard generation failed:`, err);
    }

    await job.updateProgress({ stage: "thumbnail", percent: 10 });

    let targetResolutions = MANIFEST_LADDER.filter((r) => r.height <= sourceHeight);
    if (targetResolutions.length === 0) {
      targetResolutions = [MANIFEST_LADDER[0]!];
    }

    const transcodedDir = await storage.ensureTranscodedDir(videoId);
    const manifestPath = await transcodeToDash(
      rawPath,
      transcodedDir,
      targetResolutions,
      Boolean(audioStream),
      (ffmpegPercent) => {
        const overall = 10 + ffmpegPercent * 0.75;
        job.updateProgress({ stage: "transcoding", percent: overall }).catch((err: unknown) => {
          console.error(`[transcode ${videoId}] progress update failed:`, err);
        });
      },
    );

    if (sourceHeight >= EXTRA_RENDITION.height) {
      const extraOutput = path.posix.join(transcodedDir, `${EXTRA_RENDITION.height}p.mp4`);
      await transcodeToMp4(
        rawPath,
        extraOutput,
        EXTRA_RENDITION,
        Boolean(audioStream),
        (ffmpegPercent) => {
          const overall = 85 + ffmpegPercent * 0.1;
          job
            .updateProgress({ stage: "transcoding-1080p", percent: overall })
            .catch((err: unknown) => {
              console.error(`[transcode ${videoId}] progress update failed:`, err);
            });
        },
      );
    }

    await db
      .update(video)
      .set({
        status: "ready",
        manifestPath,
        publishedAt: new Date(),
        processingError: null,
      })
      .where(eq(video.id, videoId));

    await connection.del(STREAM_META_CACHE_KEY(videoId));

    const [readyVideo] = await db
      .select({ visibility: video.visibility, userId: video.userId })
      .from(video)
      .where(eq(video.id, videoId))
      .limit(1);
    if (readyVideo && readyVideo.visibility === "public") {
      await notificationsQueue
        .add("fanout-new-upload", {
          type: "fanout-new-upload",
          videoId,
          channelId: readyVideo.userId,
        })
        .catch((err) => console.error(`[transcode ${videoId}] fanout enqueue failed:`, err));
    }

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
    await connection.del(STREAM_META_CACHE_KEY(videoId));
    throw err;
  }
}
