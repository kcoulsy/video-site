# Phase 6: Likes & Watch History

## Overview

Add a like/dislike system for videos and track user watch history with resume-from-where-you-left-off functionality. This phase adds two new tables, several API endpoints, and frontend components for interaction tracking.

## Prerequisites

- Phase 4 complete (video watch page with dash.js player exists)

## Parallel Note

This phase is independent of Phase 5 (Comments). They can be implemented in any order or in parallel after Phase 4.

---

## 1. Database Schema: Likes

### File: `packages/db/src/schema/like.ts` (new)

```typescript
import { pgTable, text, timestamp, pgEnum, primaryKey } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { video } from "./video";

export const likeTypeEnum = pgEnum("like_type", ["like", "dislike"]);

export const videoLike = pgTable(
  "video_like",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),
    type: likeTypeEnum("type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.videoId] })],
);
```

**Key design**:

- Composite primary key `(userId, videoId)` — one like/dislike per user per video
- `type` enum: "like" or "dislike" — toggling between them is a single-row update
- No separate `id` column — the composite PK is sufficient

---

## 2. Database Schema: Watch History

### File: `packages/db/src/schema/watch-history.ts` (new)

```typescript
import { pgTable, text, timestamp, integer, real, primaryKey } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { video } from "./video";

export const watchHistory = pgTable(
  "watch_history",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),

    // Progress tracking
    watchedSeconds: integer("watched_seconds").default(0).notNull(),
    totalDuration: integer("total_duration").notNull(),
    progressPercent: real("progress_percent").default(0).notNull(), // 0.0 to 1.0

    // Completion tracking
    completedAt: timestamp("completed_at"), // set when progressPercent >= 0.9

    lastWatchedAt: timestamp("last_watched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.videoId] })],
);
```

**Key design**:

- Composite primary key `(userId, videoId)` — one history entry per user per video
- `watchedSeconds` + `totalDuration` -> can compute progress on client or use `progressPercent`
- `completedAt` is set when `progressPercent >= 0.9` (90% watched = completed)
- `lastWatchedAt` is updated on every progress report — used for sorting history

---

## 3. Relations Update

### File: `packages/db/src/schema/relations.ts` (modify)

Add relations:

```typescript
import { videoLike } from "./like";
import { watchHistory } from "./watch-history";

export const videoLikeRelations = relations(videoLike, ({ one }) => ({
  user: one(user, {
    fields: [videoLike.userId],
    references: [user.id],
  }),
  video: one(video, {
    fields: [videoLike.videoId],
    references: [video.id],
  }),
}));

export const watchHistoryRelations = relations(watchHistory, ({ one }) => ({
  user: one(user, {
    fields: [watchHistory.userId],
    references: [user.id],
  }),
  video: one(video, {
    fields: [watchHistory.videoId],
    references: [video.id],
  }),
}));
```

Update existing relations:

```typescript
// In userRelations, add:
likes: many(videoLike),
watchHistory: many(watchHistory),

// In videoRelations, add:
likes: many(videoLike),
watchHistory: many(watchHistory),
```

### File: `packages/db/src/schema/index.ts` (modify)

Add: `export * from "./like"; export * from "./watch-history";`

---

## 4. API: Like/Dislike Endpoints

### File: `apps/server/src/routes/like.ts` (new)

### `POST /api/videos/:videoId/like` (auth required)

Like the video. Toggle behavior:

- If no existing record: create with `type: "like"`
- If existing record is `"like"`: remove the record (un-like)
- If existing record is `"dislike"`: update to `"like"` (switch)

**Implementation**:

```typescript
app.post("/:videoId/like", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");

  const existing = await db.query.videoLike.findFirst({
    where: and(eq(videoLikeTable.userId, userId), eq(videoLikeTable.videoId, videoId)),
  });

  await db.transaction(async (tx) => {
    if (!existing) {
      // Create new like
      await tx.insert(videoLikeTable).values({ userId, videoId, type: "like" });
      await tx
        .update(videoTable)
        .set({ likeCount: sql`${videoTable.likeCount} + 1` })
        .where(eq(videoTable.id, videoId));
    } else if (existing.type === "like") {
      // Remove like (toggle off)
      await tx
        .delete(videoLikeTable)
        .where(and(eq(videoLikeTable.userId, userId), eq(videoLikeTable.videoId, videoId)));
      await tx
        .update(videoTable)
        .set({ likeCount: sql`${videoTable.likeCount} - 1` })
        .where(eq(videoTable.id, videoId));
    } else {
      // Switch from dislike to like
      await tx
        .update(videoLikeTable)
        .set({ type: "like", createdAt: new Date() })
        .where(and(eq(videoLikeTable.userId, userId), eq(videoLikeTable.videoId, videoId)));
      await tx
        .update(videoTable)
        .set({
          likeCount: sql`${videoTable.likeCount} + 1`,
          dislikeCount: sql`${videoTable.dislikeCount} - 1`,
        })
        .where(eq(videoTable.id, videoId));
    }
  });

  return c.json({ type: existing?.type === "like" ? null : "like" });
});
```

### `POST /api/videos/:videoId/dislike` (auth required)

Same toggle logic as like, but for "dislike". Mirror implementation.

_(No separate `DELETE /api/videos/:videoId/like` endpoint needed — the `POST /like` toggle already handles removing a like when clicked again, and `POST /dislike` handles switching. This avoids API redundancy.)_

### `GET /api/videos/:videoId/like` (auth required)

Get the current user's like state for a video:

```typescript
app.get("/:videoId/like", requireAuth, async (c) => {
  const existing = await db.query.videoLike.findFirst({
    where: and(
      eq(videoLikeTable.userId, c.get("user").id),
      eq(videoLikeTable.videoId, c.req.param("videoId")),
    ),
  });
  return c.json({ type: existing?.type ?? null });
});
```

---

## 5. API: Watch History Endpoints

### File: `apps/server/src/routes/watch-history.ts` (new)

### `POST /api/videos/:videoId/progress` (auth required)

Upsert the user's watch progress. Called every 10 seconds during playback.

**Request body**:

```json
{
  "watchedSeconds": 145,
  "totalDuration": 600
}
```

**Implementation**:

```typescript
app.post("/:videoId/progress", requireAuth, async (c) => {
  const userId = c.get("user").id;
  const videoId = c.req.param("videoId");
  const { watchedSeconds, totalDuration } = await c.req.json();

  const progressPercent = Math.min(watchedSeconds / totalDuration, 1.0);
  const completed = progressPercent >= 0.9;

  await db
    .insert(watchHistoryTable)
    .values({
      userId,
      videoId,
      watchedSeconds,
      totalDuration,
      progressPercent,
      completedAt: completed ? new Date() : null,
      lastWatchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [watchHistoryTable.userId, watchHistoryTable.videoId],
      set: {
        watchedSeconds,
        totalDuration,
        progressPercent,
        completedAt: completed ? new Date() : undefined,
        lastWatchedAt: new Date(),
      },
    });

  return c.json({ ok: true });
});
```

### `GET /api/videos/:videoId/progress` (auth required)

Get the user's progress for a specific video (used to resume playback):

```typescript
app.get("/:videoId/progress", requireAuth, async (c) => {
  const entry = await db.query.watchHistory.findFirst({
    where: and(
      eq(watchHistoryTable.userId, c.get("user").id),
      eq(watchHistoryTable.videoId, c.req.param("videoId")),
    ),
  });

  if (!entry) return c.json({ watchedSeconds: 0, progressPercent: 0 });

  return c.json({
    watchedSeconds: entry.watchedSeconds,
    totalDuration: entry.totalDuration,
    progressPercent: entry.progressPercent,
    completedAt: entry.completedAt,
  });
});
```

### `GET /api/history` (auth required)

List the user's watch history, ordered by `lastWatchedAt DESC`:

**Query params**:

- `page` (default 1)
- `limit` (default 24, max 50)

**Response** includes video details (join with video table):

```json
{
  "items": [
    {
      "videoId": "abc123",
      "watchedSeconds": 145,
      "totalDuration": 600,
      "progressPercent": 0.24,
      "lastWatchedAt": "2026-04-24T...",
      "video": {
        "id": "abc123",
        "title": "My Video",
        "thumbnailUrl": "...",
        "duration": 600,
        "user": { "name": "...", "image": "..." }
      }
    }
  ],
  "page": 1,
  "totalPages": 3
}
```

### `DELETE /api/history/:videoId` (auth required)

Remove a single video from watch history.

### `DELETE /api/history` (auth required)

Clear all watch history for the authenticated user.

---

## 6. Frontend: Like Button

### File: `apps/web/src/components/like-button.tsx` (new)

Displays like and dislike buttons with counts.

**Layout**:

```
[ThumbsUp 1.2K] [ThumbsDown 45]
```

Props:

```typescript
interface LikeButtonProps {
  videoId: string;
  likeCount: number;
  dislikeCount: number;
  isAuthenticated: boolean;
}
```

Implementation:

- Fetch user's like state via `GET /api/videos/:videoId/like` (only if authenticated)
- Use React Query for the like state query
- `useMutation` for like/dislike actions with **optimistic updates**:
  - Immediately update the displayed count and filled/unfilled icon state
  - On error, revert and show toast
- Icons: `ThumbsUp` and `ThumbsDown` from Lucide React
- Active state: filled icon + highlighted color (like = blue, dislike = gray)
- Inactive state: outline icon
- If not authenticated: icons are clickable but trigger a toast "Sign in to like this video" or navigate to login

**Optimistic update pattern**:

```typescript
const likeMutation = useMutation({
  mutationFn: () => apiClient(`/api/videos/${videoId}/like`, { method: "POST" }),
  onMutate: async () => {
    await queryClient.cancelQueries({ queryKey: ["like-state", videoId] });
    const previous = queryClient.getQueryData(["like-state", videoId]);

    // Optimistically update
    queryClient.setQueryData(["like-state", videoId], (old) => {
      if (old?.type === "like") return { type: null }; // toggle off
      return { type: "like" };
    });

    // Also update the video data's like/dislike counts
    // ...

    return { previous };
  },
  onError: (err, vars, context) => {
    queryClient.setQueryData(["like-state", videoId], context?.previous);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ["like-state", videoId] });
    queryClient.invalidateQueries({ queryKey: ["video", videoId] });
  },
});
```

---

## 7. Frontend: Watch Progress Bar

### File: `apps/web/src/components/watch-progress-bar.tsx` (new)

A thin colored bar shown at the bottom of video thumbnails in feeds and history, indicating how much the user has watched.

```typescript
interface WatchProgressBarProps {
  progressPercent: number; // 0.0 to 1.0
}

export function WatchProgressBar({ progressPercent }: WatchProgressBarProps) {
  if (progressPercent <= 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
      <div
        className="h-full bg-red-600"
        style={{ width: `${Math.min(progressPercent * 100, 100)}%` }}
      />
    </div>
  );
}
```

Positioned absolutely within the thumbnail container of `VideoCard`.

---

## 8. Frontend: Watch History Page

### File: `apps/web/src/routes/history.tsx` (new)

Protected route accessible from the user menu.

**Layout**:

```
+--------------------------------------------------+
| Watch History                   [Clear all]       |
+--------------------------------------------------+
| Continue Watching (if any < 90% progress)        |
| [VideoCard] [VideoCard] [VideoCard]              |
+--------------------------------------------------+
| All History                                       |
| [VideoCard] [VideoCard] [VideoCard]              |
| [VideoCard] [VideoCard] [VideoCard]              |
| [Load more]                                       |
+--------------------------------------------------+
```

Features:

- **"Continue Watching" section**: Filter history items where `progressPercent < 0.9`. Show in a horizontal scrolling row or small grid.
- **"All History" section**: Full history in a grid, paginated.
- Each video card shows:
  - Thumbnail with `WatchProgressBar` overlay
  - Title, uploader, duration
  - "Last watched X ago" instead of upload date
  - Remove button (X icon) to remove from history
- "Clear all history" button with confirmation dialog
- Empty state: "No watch history yet"

Route definition:

```typescript
export const Route = createFileRoute("/history")({
  component: HistoryPage,
  beforeLoad: async () => {
    const session = await getUser();
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
});
```

---

## 9. Frontend: Watch Page Updates

### File: `apps/web/src/routes/watch.$videoId.tsx` (modify)

Add three integrations:

### A. Like Button

Below the video title, add the `LikeButton` component:

```typescript
<LikeButton
  videoId={video.id}
  likeCount={video.likeCount}
  dislikeCount={video.dislikeCount}
  isAuthenticated={!!session}
/>
```

### B. Progress Loading (Resume Playback)

On page load, if authenticated, fetch the user's progress:

```typescript
const { data: progress } = useQuery({
  queryKey: ["video-progress", videoId],
  queryFn: () => apiClient(`/api/videos/${videoId}/progress`),
  enabled: !!session, // only if authenticated
});

// Pass to player
<VideoPlayer
  manifestUrl={video.streamUrl}
  initialTime={progress?.progressPercent < 0.9 ? progress?.watchedSeconds : 0}
/>
```

If progress exists and < 90%, the player seeks to `initialTime` on load.

### C. Progress Reporting

Report watch progress every 10 seconds during playback:

```typescript
const lastReportedTime = useRef(0);

function handleTimeUpdate(currentTime: number) {
  // Only report every 10 seconds of playback
  if (Math.abs(currentTime - lastReportedTime.current) >= 10) {
    lastReportedTime.current = currentTime;
    reportProgress(currentTime);
  }
}

function reportProgress(watchedSeconds: number) {
  if (!session) return; // only for authenticated users
  apiClient(`/api/videos/${videoId}/progress`, {
    method: "POST",
    body: JSON.stringify({
      watchedSeconds: Math.floor(watchedSeconds),
      totalDuration: video.duration,
    }),
  }).catch(() => {}); // fire-and-forget, don't block playback
}

// Also report on unmount (user navigates away)
// Use refs for values needed in cleanup to avoid stale closures
const videoIdRef = useRef(videoId);
const durationRef = useRef(video.duration);
useEffect(() => {
  videoIdRef.current = videoId;
}, [videoId]);
useEffect(() => {
  durationRef.current = video.duration;
}, [video.duration]);

useEffect(() => {
  return () => {
    if (lastReportedTime.current > 0) {
      // Use navigator.sendBeacon for reliability on page unload
      navigator.sendBeacon(
        `${VITE_SERVER_URL}/api/videos/${videoIdRef.current}/progress`,
        new Blob(
          [
            JSON.stringify({
              watchedSeconds: Math.floor(lastReportedTime.current),
              totalDuration: durationRef.current,
            }),
          ],
          { type: "application/json" },
        ),
      );
    }
  };
}, []);
```

**Note on `sendBeacon`**: `navigator.sendBeacon` sends a POST request that survives page navigation. However, it sends `Content-Type: text/plain` by default. The server endpoint should handle both `application/json` and `text/plain` content types, or use a `Blob` with explicit content type:

```typescript
navigator.sendBeacon(url, new Blob([JSON.stringify(body)], { type: "application/json" }));
```

---

## 10. Video Player Update

### File: `apps/web/src/components/video-player.tsx` (modify)

Ensure the player supports:

- `initialTime` prop: seek to this position after the player is ready
- `onTimeUpdate` prop: fires on every `timeupdate` event from `<video>`

The `onTimeUpdate` callback provides `currentTime` in seconds. The parent component (`WatchPage`) handles the debouncing logic.

---

## 11. User Menu Update

### File: `apps/web/src/components/user-menu.tsx` (modify)

Add "Watch History" link to the dropdown menu:

```typescript
<DropdownMenuItem asChild>
  <Link to="/history">Watch History</Link>
</DropdownMenuItem>
```

---

## 12. Video Card Update

### File: `apps/web/src/components/video-card.tsx` (modify)

Accept optional `progressPercent` prop. When provided, render `WatchProgressBar` overlay on the thumbnail:

```typescript
interface VideoCardProps {
  // ... existing props
  progressPercent?: number;
}

// In the thumbnail container:
<div className="relative">
  <img ... />
  {progressPercent != null && (
    <WatchProgressBar progressPercent={progressPercent} />
  )}
</div>
```

---

## Verification Checklist

### Likes

1. Like a video -> ThumbsUp fills, like count increments by 1
2. Like again (toggle off) -> ThumbsUp unfills, like count decrements
3. Dislike a liked video -> ThumbsUp unfills, ThumbsDown fills, like count -1, dislike count +1
4. Refresh page -> like state persists from server
5. Unauthenticated user clicks like -> toast message or login redirect
6. Optimistic update: count changes immediately, not after server response

### Watch History

7. Play a video for 15 seconds -> progress saved to server (check DB or API)
8. Navigate away -> progress saved via `sendBeacon`
9. Return to same video -> player resumes from last position
10. `/history` page shows the video with correct progress bar
11. "Continue watching" section shows videos with < 90% progress
12. Watch a video to 90%+ -> marked as completed, removed from "Continue watching"
13. Remove a video from history -> disappears from list
14. "Clear all history" -> empties the list
15. Progress bar appears on video thumbnails in history page

---

## Files Summary

| Action | File                                                                 |
| ------ | -------------------------------------------------------------------- |
| Create | `packages/db/src/schema/like.ts`                                     |
| Create | `packages/db/src/schema/watch-history.ts`                            |
| Create | `apps/server/src/routes/like.ts`                                     |
| Create | `apps/server/src/routes/watch-history.ts`                            |
| Create | `apps/web/src/components/like-button.tsx`                            |
| Create | `apps/web/src/components/watch-progress-bar.tsx`                     |
| Create | `apps/web/src/routes/history.tsx`                                    |
| Modify | `packages/db/src/schema/relations.ts` (add like + history relations) |
| Modify | `packages/db/src/schema/index.ts` (add exports)                      |
| Modify | `apps/server/src/index.ts` (mount like + history routes)             |
| Modify | `apps/web/src/routes/watch.$videoId.tsx` (like button, progress)     |
| Modify | `apps/web/src/components/video-player.tsx` (initialTime handling)    |
| Modify | `apps/web/src/components/video-card.tsx` (progress bar)              |
| Modify | `apps/web/src/components/user-menu.tsx` (history link)               |

## Dependencies to Install

None — all dependencies are already available from prior phases.
