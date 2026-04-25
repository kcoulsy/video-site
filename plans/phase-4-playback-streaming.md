1# Phase 4: Video Playback & Streaming

## Overview

Serve DASH content (`.mpd` manifests and `.m4s` segments) through the Hono server with proper headers and range request support, integrate dash.js on the frontend for adaptive bitrate playback, build the video watch page, and replace the home page with a video feed.

## Prerequisites

- Phase 3 complete (DASH-transcoded videos exist in `storage/videos/{id}/transcoded/`)
- At least one video successfully processed to `ready` status

---

## 1. Streaming Endpoints

### File: `apps/server/src/routes/streaming.ts` (new)

Mounted at `/api/stream` in the main app.

### `GET /api/stream/:videoId/manifest.mpd`

Serve the DASH manifest file.

```typescript
app.get("/:videoId/manifest.mpd", async (c) => {
  const video = await db.query.video.findFirst({
    where: and(
      eq(videoTable.id, c.req.param("videoId")),
      eq(videoTable.status, "ready"),
    ),
  });
  if (!video || !video.manifestPath) return c.notFound();

  // Verify visibility — allow public + unlisted, block private (unless owner)
  if (video.visibility === "private") {
    // Check auth, verify ownership — return 404 if not owner
  }

  const filePath = storage.resolve(video.manifestPath);
  if (!await storage.fileExists(filePath)) return c.notFound();

  const file = Bun.file(filePath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": "application/dash+xml",
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=5", // short cache — manifest could change on re-transcode
      // Note: CORS headers are handled by the global Hono CORS middleware — do NOT set them here
    },
  });
});
```

### `GET /api/stream/:videoId/:filename`

Serve segment files (`.m4s` init segments and media chunks).

```typescript
app.get("/:videoId/:filename", async (c) => {
  const { videoId, filename } = c.req.param();

  // Security: strict filename validation — only allow known FFmpeg segment patterns
  const validFilename = /^(init-stream\d+|chunk-stream\d+-\d{5})\.m4s$/.test(filename);
  if (!validFilename) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  // Resolve the file path
  const filePath = storage.resolve("videos", videoId, "transcoded", filename);
  if (!await storage.fileExists(filePath)) return c.notFound();

  const file = Bun.file(filePath);
  const contentType = getContentType(filename);

  // Handle Range requests for seeking
  const range = c.req.header("Range");
  if (range) {
    return handleRangeRequest(file, range, contentType);
  }

  return new Response(file.stream(), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=31536000, immutable", // segments never change
      "Accept-Ranges": "bytes",
    },
  });
});
```

### Content-Type Mapping

```typescript
function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mpd": return "application/dash+xml";
    case "m4s": return "video/iso.segment";
    case "mp4": return "video/mp4";
    case "m4a": return "audio/mp4";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    default: return "application/octet-stream";
  }
}
```

### Range Request Handler

```typescript
function handleRangeRequest(
  file: BunFile,
  rangeHeader: string,
  contentType: string,
): Response {
  const fileSize = file.size;
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return new Response("Invalid Range", { status: 416 });
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (start >= fileSize || end >= fileSize) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }

  const chunkSize = end - start + 1;

  return new Response(file.slice(start, end + 1).stream(), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Content-Length": String(chunkSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

### `GET /api/stream/:videoId/thumbnail`

Serve the thumbnail image:

```typescript
app.get("/:videoId/thumbnail", async (c) => {
  const video = await db.query.video.findFirst({
    where: eq(videoTable.id, c.req.param("videoId")),
    columns: { thumbnailPath: true, visibility: true, userId: true },
  });
  if (!video || !video.thumbnailPath) return c.notFound();

  const filePath = storage.resolve(video.thumbnailPath);
  if (!await storage.fileExists(filePath)) return c.notFound();

  const file = Bun.file(filePath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=3600", // 1 hour — may change via custom thumbnail
    },
  });
});
```

---

## 2. View Counting

### File: `apps/server/src/routes/video.ts` (modify)

Add view increment endpoint:

### `POST /api/videos/:id/view`

Debounce: one view per user per video per 24 hours. Use Redis for deduplication:

```typescript
app.post("/:id/view", async (c) => {
  const videoId = c.req.param("id");

  // Get user identifier (user ID if authenticated, or IP + user-agent hash)
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const viewerKey = session
    ? `view:${videoId}:user:${session.user.id}`
    : `view:${videoId}:anon:${hashIpUa(c)}`;

  // Atomically set-if-not-exists with 24h expiry to prevent race conditions
  // (two concurrent requests both reading "not viewed" and both incrementing)
  const redis = getRedisClient();
  const wasSet = await redis.set(viewerKey, "1", "EX", 86400, "NX");
  if (!wasSet) {
    return c.json({ counted: false });
  }

  // Only increment if the key was newly set (first view in 24h window)
  await db.update(videoTable)
    .set({ viewCount: sql`${videoTable.viewCount} + 1` })
    .where(eq(videoTable.id, videoId));

  return c.json({ counted: true });
});
```

### `GET /api/videos/:id` response update

Add `streamUrl` to the response. Use relative paths — the frontend already knows the server URL via `VITE_SERVER_URL`:

```typescript
const streamUrl = video.status === "ready"
  ? `/api/stream/${video.id}/manifest.mpd`
  : null;

return c.json({
  ...video,
  streamUrl,
  thumbnailUrl: video.thumbnailPath
    ? `/api/stream/${video.id}/thumbnail`
    : null,
  user: {
    id: video.user.id,
    name: video.user.name,
    image: video.user.image,
  },
});
```

---

## 3. Redis Client for Server

### File: `apps/server/src/lib/redis.ts` (new)

```typescript
import IORedis from "ioredis";
import { env } from "@video-site/env/server";

let redis: IORedis | null = null;

export function getRedisClient(): IORedis {
  if (!redis) {
    redis = new IORedis(env.REDIS_URL);
    // Note: do NOT set maxRetriesPerRequest: null here — that's only needed
    // for BullMQ workers/queues. The default retry behavior is correct for
    // regular Redis get/set operations.
  }
  return redis;
}
```

(If `ioredis` is not yet a dependency of `apps/server`, add it in this phase.)

---

## 4. Frontend: Video Player Component

### Dependencies to install:
```
pnpm -F apps/web add dashjs
```

### File: `apps/web/src/components/video-player.tsx` (new)

```typescript
// Note: do NOT import dashjs at the top level — TanStack Start supports SSR,
// and dashjs requires DOM APIs. Use a dynamic import inside useEffect instead.
import { useEffect, useRef, useCallback } from "react";

interface VideoPlayerProps {
  manifestUrl: string;
  autoPlay?: boolean;
  initialTime?: number;           // Resume from this time (seconds)
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
}

export function VideoPlayer({
  manifestUrl,
  autoPlay = false,
  initialTime,
  onTimeUpdate,
  onEnded,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<dashjs.MediaPlayerClass | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    let cancelled = false;

    // Dynamic import to avoid SSR crashes (dashjs requires DOM)
    import("dashjs").then(({ default: dashjs }) => {
      if (cancelled || !videoRef.current) return;

    const player = dashjs.MediaPlayer().create();
    player.initialize(videoRef.current, manifestUrl, autoPlay);

    player.updateSettings({
      streaming: {
        abr: {
          autoSwitchBitrate: { video: true, audio: true },
        },
        buffer: {
          fastSwitchEnabled: true,
          stableBufferTime: 12,
          bufferTimeAtTopQuality: 30,
        },
      },
    });

    // Seek to initial time if provided (for resume)
    if (initialTime && initialTime > 0) {
      player.on(dashjs.MediaPlayer.events.CAN_PLAY, () => {
        player.seek(initialTime);
      });
    }

    playerRef.current = player;
    }); // end import("dashjs").then(...)

    return () => {
      cancelled = true;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [manifestUrl]); // Only re-init when manifest URL changes

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        className="h-full w-full"
        controls
        onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
        onEnded={() => onEnded?.()}
      />
    </div>
  );
}
```

### Key dash.js behaviors:
- **ABR auto-switch**: dash.js automatically selects the best quality based on network bandwidth
- **Buffer settings**: `stableBufferTime: 12` means dash.js tries to maintain 12 seconds of buffered content; `bufferTimeAtTopQuality: 30` allows more buffering when at the highest quality
- **`fastSwitchEnabled`**: Allows quicker quality switching when bandwidth changes

---

## 5. Frontend: Quality Selector

### File: `apps/web/src/components/quality-selector.tsx` (new)

A dropdown for manual quality override. Accesses the dash.js player instance:

```typescript
interface QualitySelectorProps {
  player: dashjs.MediaPlayerClass | null;
}

export function QualitySelector({ player }: QualitySelectorProps) {
  // Get available qualities from player
  // player.getBitrateInfoListFor("video") returns available bitrates
  // player.getQualityFor("video") returns current quality index

  // Display options: "Auto", "360p", "720p", "1080p"
  // On select:
  //   "Auto" -> player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } })
  //   Specific -> player.setQualityFor("video", index, true);
  //               player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } })
}
```

Expose the player ref from `VideoPlayer` via either a callback ref prop or `useImperativeHandle`.

---

## 6. Frontend: Video Card & Grid

### File: `apps/web/src/components/video-card.tsx` (new)

Reusable card for displaying a video in grid/list layouts:

```
+---------------------------+
| [Thumbnail Image]         |
|                   [12:34] |  <- duration overlay, bottom-right
+---------------------------+
| Title (truncated to 2...)  |
| User Name                  |
| 1.2K views · 3 days ago    |
+---------------------------+
```

Props:
```typescript
interface VideoCardProps {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;      // seconds
  viewCount: number;
  createdAt: string;
  user: { name: string; image?: string | null };
}
```

Implementation details:
- Thumbnail: `<img>` with fallback placeholder (gray with play icon)
- Duration overlay: format as `H:MM:SS` or `M:SS`, absolute-positioned bottom-right on a semi-transparent black background
- Title: `line-clamp-2` for two-line truncation
- View count: format with abbreviations (1.2K, 3.4M)
- Relative time: use a helper function ("3 days ago", "2 hours ago")
- Entire card is a `<Link to="/watch/$videoId">`

### Utility: `apps/web/src/lib/format.ts` (new)

```typescript
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function formatRelativeTime(dateString: string): string {
  // Compute relative time from now
  // Return "X seconds/minutes/hours/days/weeks/months/years ago"
}
```

### File: `apps/web/src/components/video-grid.tsx` (new)

Responsive CSS grid layout:

```typescript
interface VideoGridProps {
  videos: VideoCardProps[];
}

export function VideoGrid({ videos }: VideoGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {videos.map((video) => (
        <VideoCard key={video.id} {...video} />
      ))}
    </div>
  );
}
```

---

## 7. Frontend: Watch Page

### File: `apps/web/src/routes/watch.$videoId.tsx` (new)

TanStack Router file-based route. URL pattern: `/watch/:videoId`

Route definition:
```typescript
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/watch/$videoId")({
  component: WatchPage,
  loader: async ({ params }) => {
    // Fetch video details from GET /api/videos/:id
    // Return video data for the component
  },
});
```

**Page layout**:
```
+---------------------------------------+-------------------+
|                                       |                   |
|  [Video Player - full width]          | (sidebar - later) |
|                                       |                   |
+---------------------------------------+-------------------+
| Title                                                     |
| View Count · Published Date                               |
| [Like] [Dislike] (Phase 6)                                |
+-----------------------------------------------------------+
| User Avatar | User Name                                   |
+-----------------------------------------------------------+
| Description (expandable)                                  |
+-----------------------------------------------------------+
| Comments Section (Phase 5)                                |
+-----------------------------------------------------------+
```

On the watch page:
- Player uses `manifestUrl` from video data
- Fire `POST /api/videos/:id/view` after 5 seconds of playback (use a ref to track)
- Title, description, view count, published date below the player
- Description: collapsed by default with "Show more" / "Show less" toggle if long

### View counting trigger:

```typescript
const viewReported = useRef(false);

function handleTimeUpdate(time: number) {
  if (!viewReported.current && time >= 5) {
    viewReported.current = true;
    apiClient(`/api/videos/${videoId}/view`, { method: "POST" });
  }
}
```

---

## 8. Frontend: Home Page Update

### File: `apps/web/src/routes/index.tsx` (modify)

Replace the placeholder/ASCII art home page with a video feed:

```typescript
export const Route = createFileRoute("/")({
  component: HomePage,
  loader: async () => {
    // Fetch from GET /api/videos?page=1&limit=24&sort=newest
  },
});

function HomePage() {
  // Use React Query for data fetching with pagination
  // Display VideoGrid with the results
  // Add pagination controls at the bottom (or infinite scroll)
}
```

**Infinite scroll** (preferred over pagination):
- Use `useInfiniteQuery` from React Query
- Fetch next page when user scrolls near the bottom
- `getNextPageParam` derives the next page from current response

---

## 9. Main App Route Mounting

### File: `apps/server/src/index.ts` (modify)

Add streaming routes:
```typescript
import streamingRoutes from "./routes/streaming";
app.route("/api/stream", streamingRoutes);
```

---

## Verification Checklist

1. Navigate to `/watch/{videoId}` for a ready video -> player loads and video plays
2. dash.js adaptively selects quality based on network conditions
3. Quality selector shows available resolutions (e.g., 360p, 720p, 1080p) and "Auto"
4. Switching quality works — player transitions to selected resolution
5. Seeking works (range request support)
6. Home page shows a grid of public ready videos with thumbnails
7. Video cards show correct thumbnails, titles, durations, view counts, relative dates
8. Clicking a video card navigates to the watch page
9. View count increments after 5 seconds of playback
10. View count does NOT double-increment on refresh within 24 hours
11. Private videos return 404 for non-owners
12. Unlisted videos are accessible by direct URL but don't appear in the feed
13. Segments serve with `immutable` cache headers
14. Thumbnail images load correctly on cards and watch page

---

## Files Summary

| Action | File |
|--------|------|
| Create | `apps/server/src/routes/streaming.ts` |
| Create | `apps/server/src/lib/redis.ts` |
| Create | `apps/web/src/components/video-player.tsx` |
| Create | `apps/web/src/components/quality-selector.tsx` |
| Create | `apps/web/src/components/video-card.tsx` |
| Create | `apps/web/src/components/video-grid.tsx` |
| Create | `apps/web/src/routes/watch.$videoId.tsx` |
| Create | `apps/web/src/lib/format.ts` |
| Modify | `apps/server/src/routes/video.ts` (view endpoint, streamUrl in response) |
| Modify | `apps/server/src/index.ts` (mount streaming routes) |
| Modify | `apps/web/src/routes/index.tsx` (video feed) |

## Dependencies to Install

| Package | Workspace |
|---------|-----------|
| `dashjs` | `apps/web` |
| `ioredis` | `apps/server` (if not already added in Phase 3) |
