# Phase 3: Video Processing Pipeline

## Overview

Create the `apps/worker` application that consumes BullMQ jobs from Redis, transcodes uploaded videos to DASH format at multiple resolutions using FFmpeg, and extracts thumbnails. This phase also adds processing status polling on the frontend and custom thumbnail upload.

## Prerequisites

- Phase 2 complete (video records in DB, raw files on disk after upload)
- FFmpeg and FFprobe installed on the development machine
- Redis running (from Phase 1 Docker Compose)

---

## 1. New App: `apps/worker`

### File: `apps/worker/package.json`

```json
{
  "name": "worker",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "tsdown",
    "start": "bun run dist/index.mjs"
  },
  "dependencies": {
    "@video-site/db": "workspace:*",
    "@video-site/env": "workspace:*",
    "@video-site/storage": "workspace:*",
    "bullmq": "^5.0.0",
    "ioredis": "^5.0.0",
    "fluent-ffmpeg": "^2.1.0",
    "dotenv": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/fluent-ffmpeg": "^2.1.0",
    "@types/bun": "catalog:",
    "@video-site/config": "workspace:*",
    "tsdown": "catalog:",
    "typescript": "catalog:"
  }
}
```

### File: `apps/worker/tsconfig.json`

```json
{
  "extends": "@video-site/config/tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

### File: `apps/worker/tsdown.config.ts`

Same pattern as `apps/server/tsdown.config.ts`.

### File: `apps/worker/.env`

```
DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
REDIS_URL=redis://localhost:6379
# STORAGE_PATH=
# FFMPEG_PATH=ffmpeg
# FFPROBE_PATH=ffprobe
# CONCURRENCY=2
```

---

## 2. Queue Definitions

### File: `apps/worker/src/queues.ts`

```typescript
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { env } from "@video-site/env/worker";

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

// Queue names
export const TRANSCODE_QUEUE = "video-transcode";
export const THUMBNAIL_QUEUE = "video-thumbnail";
export const CLEANUP_QUEUE = "video-cleanup";
```

### Job Data Types

Define shared types (can live in `apps/worker/src/types.ts` or a shared package):

```typescript
export interface TranscodeJobData {
  videoId: string;
  rawPath: string; // relative to STORAGE_PATH
  userId: string;
}

export interface ThumbnailJobData {
  videoId: string;
  thumbnailSourcePath: string; // path to uploaded custom thumbnail
}

export interface CleanupJobData {
  type: "stale-uploads" | "failed-videos" | "delete-video";
  videoId?: string;
}
```

---

## 3. Main Worker Entry Point

### File: `apps/worker/src/index.ts`

```typescript
import "dotenv/config";
import { Worker } from "bullmq";
import { connection, TRANSCODE_QUEUE, THUMBNAIL_QUEUE, CLEANUP_QUEUE } from "./queues";
import { processTranscode } from "./processors/transcode";
import { processThumbnail } from "./processors/thumbnail";
import { processCleanup } from "./processors/cleanup";
import { env } from "@video-site/env/worker";

// Transcode worker
const transcodeWorker = new Worker(TRANSCODE_QUEUE, processTranscode, {
  connection,
  concurrency: env.CONCURRENCY,
});

// Thumbnail worker
const thumbnailWorker = new Worker(THUMBNAIL_QUEUE, processThumbnail, {
  connection,
  concurrency: 2,
});

// Cleanup worker
const cleanupWorker = new Worker(CLEANUP_QUEUE, processCleanup, {
  connection,
  concurrency: 1,
});

// Event logging
for (const [name, worker] of Object.entries({
  transcode: transcodeWorker,
  thumbnail: thumbnailWorker,
  cleanup: cleanupWorker,
})) {
  worker.on("completed", (job) => {
    console.log(`[${name}] Job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[${name}] Job ${job?.id} failed:`, err.message);
  });
}

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([transcodeWorker.close(), thumbnailWorker.close(), cleanupWorker.close()]);
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`Worker started (concurrency: ${env.CONCURRENCY})`);
```

---

## 4. Transcode Processor

### File: `apps/worker/src/processors/transcode.ts`

This is the core of the pipeline. It processes a single video from raw upload to DASH output.

### Processing Pipeline

#### Step 0: Set status to "processing"

Before any work, update the DB so the frontend can reflect the correct state:

```typescript
await db.update(videoTable).set({ status: "processing" }).where(eq(videoTable.id, videoId));
```

#### Step 1: Probe the raw file

Use `ffprobe` to extract metadata:

```typescript
import ffmpeg from "fluent-ffmpeg";
import { env } from "@video-site/env/worker";

ffmpeg.setFfmpegPath(env.FFMPEG_PATH);
ffmpeg.setFfprobePath(env.FFPROBE_PATH);

function probe(filePath: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      err ? reject(err) : resolve(data);
    });
  });
}
```

Extract from probe data:

- `duration` (seconds)
- `width`, `height` from the video stream
- `codec_name` for video and audio
- Validate: reject if `duration > 1800` (30 minutes)

Update DB with `duration`, `width`, `height`.

Report progress: `job.updateProgress({ stage: "probing", percent: 5 })`

#### Step 2: Determine resolution ladder

Only transcode to resolutions that are <= the source resolution:

```typescript
const RESOLUTION_LADDER = [
  { height: 360, width: 640, bitrate: "800k", profile: "main" },
  { height: 720, width: 1280, bitrate: "2500k", profile: "main" },
  { height: 1080, width: 1920, bitrate: "5000k", profile: "high" },
];

const targetResolutions = RESOLUTION_LADDER.filter((r) => r.height <= sourceHeight);

// If source is smaller than 360p, still produce a 360p output
if (targetResolutions.length === 0) {
  targetResolutions.push(RESOLUTION_LADDER[0]);
}
```

#### Step 3: Generate thumbnail

Extract a frame at 25% of the video duration:

```
ffmpeg -i input.mp4 \
  -ss <duration * 0.25> \
  -vframes 1 \
  -vf "scale=640:-2" \
  -q:v 2 \
  storage/videos/{videoId}/thumbnails/thumbnail.jpg
```

Implementation with fluent-ffmpeg:

```typescript
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
      .output(outputPath)
      .outputOptions("-q:v", "2")
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}
```

Update DB: `thumbnailPath`

Report progress: `job.updateProgress({ stage: "thumbnail", percent: 10 })`

#### Step 4: Transcode to DASH

Build the FFmpeg command dynamically based on the resolution ladder:

```
ffmpeg -i input.mp4 \
  -map 0:v -map 0:v -map 0:v -map 0:a? \
  -c:v:0 libx264 -b:v:0 800k  -s:v:0 640x360   -profile:v:0 main \
  -c:v:1 libx264 -b:v:1 2500k -s:v:1 1280x720  -profile:v:1 main \
  -c:v:2 libx264 -b:v:2 5000k -s:v:2 1920x1080 -profile:v:2 high \
  -c:a aac -b:a 128k -ar 44100 \
  -f dash \
  -seg_duration 4 \
  -use_template 1 \
  -use_timeline 1 \
  -init_seg_name "init-stream$RepresentationID$.m4s" \
  -media_seg_name "chunk-stream$RepresentationID$-$Number%05d$.m4s" \
  -adaptation_sets "id=0,streams=v id=1,streams=a" \
  storage/videos/{videoId}/transcoded/manifest.mpd
```

**Important FFmpeg flags**:

- `-map 0:v` repeated N times for N video renditions
- `-map 0:a?` — the `?` makes audio optional (some videos have no audio)
- `-seg_duration 4` — 4-second segments for smooth ABR switching
- `-use_template 1 -use_timeline 1` — SegmentTemplate with timeline for efficient manifests
- `-init_seg_name` / `-media_seg_name` — predictable naming for serving
- `-adaptation_sets "id=0,streams=v id=1,streams=a"` — separate adaptation sets for video and audio
- `-profile:v:0 main` / `-profile:v:2 high` — H.264 profiles (main for lower res, high for 1080p)

**Dynamic command construction** (pseudocode):

```typescript
function buildDashCommand(
  inputPath: string,
  outputDir: string,
  resolutions: Resolution[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath);

    // Add video stream maps
    for (let i = 0; i < resolutions.length; i++) {
      cmd = cmd.outputOptions(`-map`, `0:v`);
    }
    // Add audio stream map (optional)
    cmd = cmd.outputOptions(`-map`, `0:a?`);

    // Add per-stream encoding options
    for (let i = 0; i < resolutions.length; i++) {
      const r = resolutions[i];
      cmd = cmd.outputOptions(
        `-c:v:${i}`,
        "libx264",
        `-b:v:${i}`,
        r.bitrate,
        `-s:v:${i}`,
        `${r.width}x${r.height}`,
        `-profile:v:${i}`,
        r.profile,
      );
    }

    // Audio encoding
    cmd = cmd.outputOptions("-c:a", "aac", "-b:a", "128k", "-ar", "44100");

    // DASH output options
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
      "id=0,streams=v id=1,streams=a",
    );

    cmd
      .output(path.join(outputDir, "manifest.mpd"))
      .on("progress", (progress) => {
        // progress.percent may be available
        const percent = 10 + (progress.percent ?? 0) * 0.8; // 10-90%
        job.updateProgress({ stage: "transcoding", percent });
      })
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}
```

**Aspect ratio handling**: Do NOT use `-s:v:N WxH` — it forces exact dimensions and stretches non-16:9 content. Instead, use per-stream scale filters that preserve aspect ratio:

```
-filter:v:0 "scale=640:-2"
-filter:v:1 "scale=1280:-2"
-filter:v:2 "scale=1920:-2"
```

The `-2` ensures height is divisible by 2 (required by H.264). Remove the `-s:v:N` options from the FFmpeg command above and replace with these filters.

#### Step 5: Update database

After successful transcoding:

```typescript
await db
  .update(videoTable)
  .set({
    status: "ready",
    manifestPath: `videos/${videoId}/transcoded/manifest.mpd`,
    duration: probedDuration,
    width: sourceWidth,
    height: sourceHeight,
    publishedAt: new Date(),
    processingError: null,
  })
  .where(eq(videoTable.id, videoId));
```

Report progress: `job.updateProgress({ stage: "complete", percent: 100 })`

#### Step 6: Cleanup raw file (optional)

After successful transcoding, optionally delete the raw upload to save disk space:

```typescript
await storage.deleteFile(rawPath);
```

Make this configurable via an env var (e.g., `DELETE_RAW_AFTER_TRANSCODE=true`).

### Error Handling

If any step fails:

```typescript
await db
  .update(videoTable)
  .set({
    status: "failed",
    processingError: error.message,
  })
  .where(eq(videoTable.id, videoId));
```

BullMQ retry policy handles transient failures:

```typescript
defaultJobOptions: {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
}
```

---

## 5. Thumbnail Processor

### File: `apps/worker/src/processors/thumbnail.ts`

Handles custom thumbnail replacement. Job is enqueued when a user uploads a custom thumbnail via the API.

```typescript
export async function processThumbnail(job: Job<ThumbnailJobData>) {
  const { videoId, thumbnailSourcePath } = job.data;

  // Read the uploaded thumbnail
  const data = await Bun.file(thumbnailSourcePath).arrayBuffer();

  // Save to the video's thumbnail directory (overwrites existing)
  const savedPath = await storage.saveThumbnail(videoId, Buffer.from(data), "thumbnail-custom.jpg");

  // Update DB
  await db.update(videoTable).set({ thumbnailPath: savedPath }).where(eq(videoTable.id, videoId));

  // Delete the temp upload
  await storage.deleteFile(thumbnailSourcePath);
}
```

---

## 6. Cleanup Processor

### File: `apps/worker/src/processors/cleanup.ts`

A repeatable job that garbage-collects stale data.

Register as a repeatable job in `apps/worker/src/index.ts`:

```typescript
const cleanupQueue = new Queue(CLEANUP_QUEUE, { connection });
await cleanupQueue.add(
  "periodic-cleanup",
  { type: "stale-uploads" },
  { repeat: { every: 60 * 60 * 1000 } }, // every hour
);
```

**Stale uploads cleanup**: Find video records where `status = "uploading"` AND `createdAt < now - 24 hours`. Delete their files and DB records. Also scan `storage/temp/tus/` for files older than 24 hours and delete them — these are partial uploads that may not have a corresponding DB record (e.g., client disconnected before `onUploadCreate` ran).

**Failed videos cleanup**: Find video records where `status = "failed"` AND `updatedAt < now - 7 days`. Delete their files and DB records. (Keep for 7 days for debugging.)

**Video deletion**: When a user deletes a video, the API enqueues a cleanup job with `type: "delete-video"` and `videoId`. The worker deletes all files.

---

## 7. Server-Side Queue Client

### File: `apps/server/src/lib/queue.ts` (new)

The server needs to enqueue jobs but NOT process them. Create a Queue client (not a Worker):

```typescript
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "@video-site/env/server";

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const transcodeQueue = new Queue("video-transcode", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const thumbnailQueue = new Queue("video-thumbnail", {
  connection,
});

export const cleanupQueue = new Queue("video-cleanup", {
  connection,
});
```

### Dependencies to install on server:

```
pnpm -F apps/server add bullmq ioredis
```

---

## 8. Wire Up Upload Completion -> Enqueue Job

### File: `apps/server/src/routes/upload.ts` (modify)

In the tus `onUploadFinish` callback, after moving the file to storage:

```typescript
import { transcodeQueue } from "../lib/queue";

// After saving raw upload and updating DB status to "uploaded":
await transcodeQueue.add(
  "transcode",
  {
    videoId,
    rawPath: video.rawPath,
    userId: video.userId,
  },
  { jobId: videoId },
); // use videoId as jobId for direct lookup in status endpoint
```

---

## 9. Processing Status Endpoints

### File: `apps/server/src/routes/video.ts` (modify)

Add two new endpoints:

### `GET /api/videos/:id/status`

Returns the current processing status with progress info from BullMQ:

```typescript
import { transcodeQueue } from "../lib/queue";

app.get("/:id/status", requireAuth, async (c) => {
  const video = await db.query.video.findFirst({
    where: eq(videoTable.id, c.req.param("id")),
  });
  if (!video) return c.json({ error: "Not found" }, 404);

  let progress = null;
  if (video.status === "processing") {
    // Look up the job directly by videoId (used as jobId when enqueuing)
    const job = await transcodeQueue.getJob(video.id);
    progress = job?.progress ?? null;
  }

  return c.json({
    status: video.status,
    progress,
    error: video.processingError,
  });
});
```

### `POST /api/videos/:id/thumbnail`

Accept a custom thumbnail image upload (standard multipart, not tus):

```typescript
app.post("/:id/thumbnail", requireAuth, async (c) => {
  // Validate ownership
  const video = await getOwnedVideo(c);

  // Parse multipart form
  const body = await c.req.parseBody();
  const file = body["thumbnail"];
  if (!(file instanceof File)) {
    return c.json({ error: "No thumbnail file provided" }, 400);
  }

  // Validate: image/*, max 5MB
  if (!file.type.startsWith("image/")) {
    return c.json({ error: "File must be an image" }, 400);
  }
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: "Thumbnail must be under 5MB" }, 400);
  }

  // Save to temp location
  const tempPath = storage.resolve("temp", `thumb-${video.id}-${Date.now()}`);
  await Bun.write(tempPath, file);

  // Enqueue thumbnail processing job
  await thumbnailQueue.add("thumbnail", {
    videoId: video.id,
    thumbnailSourcePath: tempPath,
  });

  return c.json({ message: "Thumbnail upload queued" });
});
```

---

## 10. Frontend Updates

### File: `apps/web/src/components/video-status-badge.tsx` (new)

Color-coded badge component:

```typescript
const STATUS_CONFIG = {
  uploading: { color: "blue", icon: Upload, label: "Uploading" },
  uploaded: { color: "blue", icon: Clock, label: "Queued" },
  processing: { color: "yellow", icon: Loader, label: "Processing" },
  ready: { color: "green", icon: CheckCircle, label: "Ready" },
  failed: { color: "red", icon: AlertCircle, label: "Failed" },
};
```

Use Lucide icons. Apply Tailwind color classes. Pulse animation for "uploading" and "processing".

### File: `apps/web/src/routes/upload.tsx` (modify)

After upload completes, switch to a "processing" view:

- Show `VideoStatusBadge` with current status
- Use React Query to poll `GET /api/videos/:id/status` every 3 seconds:
  ```typescript
  const { data } = useQuery({
    queryKey: ["video-status", videoId],
    queryFn: () => apiClient(`/api/videos/${videoId}/status`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling when terminal state reached
      return status === "ready" || status === "failed" ? false : 3000;
    },
  });
  ```
- Show progress bar if progress data available (from BullMQ job progress)
- When status becomes `"ready"`: show success message + link to `/watch/{videoId}`
- When status becomes `"failed"`: show error message from `processingError`

### File: `apps/web/src/routes/dashboard.tsx` (modify)

Replace the placeholder with a list of the user's videos:

- Fetch `GET /api/videos/my` via React Query
- Display each video as a card showing:
  - Thumbnail (or placeholder if not yet generated)
  - Title
  - `VideoStatusBadge`
  - Created date (relative, e.g., "3 hours ago")
  - View count (if ready)
- Link to `/watch/{videoId}` for ready videos
- Delete button on each video

---

## 11. Turbo / Monorepo Config

### File: `turbo.json` (modify)

Add the worker to the dev pipeline:

```json
{
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "dev:worker": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"] }
  }
}
```

### File: root `package.json` (modify)

Add scripts:

```json
"dev:worker": "turbo -F worker dev",
"dev:all": "turbo dev dev:worker"
```

---

## Verification Checklist

1. `pnpm dev:worker` starts the worker process without errors
2. Upload a video via the UI -> raw file saved -> worker picks up job automatically
3. Worker probes the video and extracts duration/resolution
4. Thumbnail is generated at 25% timestamp in `storage/videos/{id}/thumbnails/`
5. DASH transcoding produces `.mpd` manifest and `.m4s` segments in `storage/videos/{id}/transcoded/`
6. Only resolutions <= source resolution are generated (e.g., 720p source -> only 360p and 720p output)
7. DB status transitions: `uploading` -> `uploaded` -> `processing` -> `ready`
8. Frontend polling shows progress during processing
9. Frontend shows "Ready" status with link to video when done
10. Failed processing: DB shows `status: "failed"` with error message, frontend displays error
11. Custom thumbnail upload: replaces auto-generated thumbnail
12. Retry: kill worker mid-processing, restart -> job is retried
13. Cleanup: stale "uploading" records cleaned up after 24h

---

## Files Summary

| Action | File                                                             |
| ------ | ---------------------------------------------------------------- |
| Create | `apps/worker/package.json`                                       |
| Create | `apps/worker/tsconfig.json`                                      |
| Create | `apps/worker/tsdown.config.ts`                                   |
| Create | `apps/worker/.env`                                               |
| Create | `apps/worker/src/index.ts`                                       |
| Create | `apps/worker/src/queues.ts`                                      |
| Create | `apps/worker/src/types.ts`                                       |
| Create | `apps/worker/src/processors/transcode.ts`                        |
| Create | `apps/worker/src/processors/thumbnail.ts`                        |
| Create | `apps/worker/src/processors/cleanup.ts`                          |
| Create | `apps/server/src/lib/queue.ts`                                   |
| Create | `apps/web/src/components/video-status-badge.tsx`                 |
| Modify | `apps/server/src/routes/upload.ts` (wire enqueue)                |
| Modify | `apps/server/src/routes/video.ts` (status + thumbnail endpoints) |
| Modify | `apps/web/src/routes/upload.tsx` (processing status view)        |
| Modify | `apps/web/src/routes/dashboard.tsx` (video list)                 |
| Modify | `turbo.json` (worker task)                                       |
| Modify | root `package.json` (worker scripts)                             |

## Dependencies to Install

| Package                | Workspace           |
| ---------------------- | ------------------- |
| `bullmq`               | `apps/worker`       |
| `ioredis`              | `apps/worker`       |
| `fluent-ffmpeg`        | `apps/worker`       |
| `@types/fluent-ffmpeg` | `apps/worker` (dev) |
| `bullmq`               | `apps/server`       |
| `ioredis`              | `apps/server`       |
