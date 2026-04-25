# Phase 2: Video Upload & Database Schema

## Overview

Create the video database table, implement tus-based chunked/resumable uploads on the server, build the upload UI on the frontend, and add basic video CRUD endpoints. After this phase, users can upload videos (which land on disk as raw files) and see their uploads listed.

## Prerequisites

- Phase 1 complete (Docker Compose running, `@video-site/storage` available, Redis connected)

---

## 1. Database Schema

### File: `packages/db/src/schema/video.ts` (new)

```typescript
import {
  pgTable, text, timestamp, integer, bigint,
  pgEnum, index,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const videoStatusEnum = pgEnum("video_status", [
  "uploading",     // tus upload in progress
  "uploaded",      // raw file on disk, awaiting processing
  "processing",    // FFmpeg worker is transcoding
  "ready",         // DASH output available
  "failed",        // processing failed
]);

export const videoVisibilityEnum = pgEnum("video_visibility", [
  "public",
  "unlisted",
  "private",
]);

export const video = pgTable(
  "video",
  {
    id: text("id").primaryKey(),  // nanoid
    title: text("title").notNull(),
    description: text("description").default(""),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    status: videoStatusEnum("status").default("uploading").notNull(),
    visibility: videoVisibilityEnum("visibility").default("public").notNull(),

    // File metadata
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    fileSize: bigint("file_size", { mode: "number" }),  // bytes
    duration: integer("duration"),   // seconds, set by ffprobe in Phase 3
    width: integer("width"),         // pixels, set by ffprobe
    height: integer("height"),       // pixels, set by ffprobe

    // Storage paths (relative to STORAGE_PATH)
    rawPath: text("raw_path"),
    manifestPath: text("manifest_path"),   // path to .mpd
    thumbnailPath: text("thumbnail_path"),

    // Tus tracking
    tusUploadId: text("tus_upload_id"),

    // Denormalized counts
    viewCount: integer("view_count").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    dislikeCount: integer("dislike_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),

    // Tags for search
    tags: text("tags").array(),

    // Processing error
    processingError: text("processing_error"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    index("video_user_id_idx").on(table.userId),
    index("video_status_idx").on(table.status),
    index("video_created_at_idx").on(table.createdAt),
    index("video_visibility_status_idx").on(table.visibility, table.status),
  ],
);
```

**Conventions followed**:
- `text("id").primaryKey()` — string IDs, matching auth tables
- camelCase JS / snake_case DB columns
- Indexes in 3rd table argument as array
- Foreign key with `onDelete: "cascade"`
- `$onUpdate` for `updatedAt`

### File: `packages/db/src/schema/relations.ts` (new)

Move ALL existing relations out of `auth.ts` into this file to avoid circular imports as more tables reference `user`. This is important because Drizzle only allows one `relations()` call per table.

```typescript
import { relations } from "drizzle-orm";
import { user, session, account } from "./auth";
import { video } from "./video";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  videos: many(video),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const videoRelations = relations(video, ({ one }) => ({
  user: one(user, {
    fields: [video.userId],
    references: [user.id],
  }),
}));
```

### File: `packages/db/src/schema/auth.ts` (modify)

**Remove** the `userRelations`, `sessionRelations`, and `accountRelations` exports (lines 76-93). Keep only the table definitions. Relations are now in `relations.ts`.

### File: `packages/db/src/schema/index.ts` (modify)

Add exports:
```typescript
export * from "./video";
export * from "./relations";
```

Ensure `auth.ts` re-export still works (it now only exports tables, not relations).

---

## 2. ID Generation

### Package: `packages/db`

Add `nanoid` as a dependency:
```
pnpm -F @video-site/db add nanoid
```

Create a helper in `packages/db/src/id.ts`:
```typescript
import { nanoid } from "nanoid";
export const generateId = () => nanoid(21);
```

Export from `packages/db/src/index.ts`:
```typescript
export { generateId } from "./id";
```

---

## 3. Server-Side Error Handling & Types

These cross-cutting files are created in this phase and used by all subsequent phases.

### File: `apps/server/src/lib/errors.ts` (new)

```typescript
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, "NOT_FOUND");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, "VALIDATION_ERROR");
  }
}
```

### File: `apps/server/src/middleware/error-handler.ts` (new)

Global Hono error handler registered on the app:
```typescript
import { AppError } from "../lib/errors";

// Usage: app.onError(errorHandler);
export function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode as any);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
}
```

### File: `apps/server/src/types.ts` (new)

Type-safe Hono context variables:
```typescript
import type { User, Session } from "better-auth";

export type AppVariables = {
  user: User;
  session: Session;
};

// Usage: const app = new Hono<{ Variables: AppVariables }>();
```

---

## 4. Auth Middleware

### File: `apps/server/src/middleware/auth.ts` (new)

```typescript
import { auth } from "@video-site/auth";
import { createMiddleware } from "hono/factory";

export const requireAuth = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});
```

---

## 5. Video CRUD Routes

### File: `apps/server/src/routes/video.ts` (new)

Mounted at `/api/videos` in the main app.

**Endpoints**:

### `POST /api/videos` (auth required)
Create a video record. Called BEFORE the tus upload starts — the client needs the `videoId` to associate the upload.

Request body:
```json
{
  "title": "My Video",
  "description": "A description",
  "visibility": "public",
  "tags": ["tag1", "tag2"],
  "filename": "my-video.mp4",
  "mimeType": "video/mp4",
  "fileSize": 52428800
}
```

Validation:
- `title`: required, 1-200 characters
- `description`: optional, max 5000 characters
- `visibility`: one of "public", "unlisted", "private"
- `tags`: optional array, max 20 tags, each max 50 chars
- `fileSize`: must be <= 500 * 1024 * 1024 (500MB)
- `mimeType`: must start with `video/`

Response:
```json
{
  "id": "abc123",
  "uploadUrl": "/api/uploads"
}
```

### `GET /api/videos/my` (auth required)
List the authenticated user's videos in ALL statuses. Paginated. Used for the dashboard.

**Important**: This route MUST be registered before `GET /api/videos/:id` — otherwise Hono matches "my" as an `:id` parameter and returns 404.

### `GET /api/videos` (public)
List videos. Only returns `status: "ready"` and `visibility: "public"` videos.

Query params:
- `page` (default 1)
- `limit` (default 24, max 50)
- `sort`: "newest" (default), "oldest", "popular" (by viewCount)

Response includes: id, title, thumbnailPath (as URL), duration, viewCount, createdAt, user (id, name, image).

### `GET /api/videos/:id` (public)
Single video details. Returns 404 for non-existent or private videos (unless owner). Includes all fields plus user info.

### `PATCH /api/videos/:id` (auth, owner only)
Update title, description, visibility, tags. Validate ownership — the `userId` on the video must match the authenticated user.

### `DELETE /api/videos/:id` (auth, owner only)
Delete the video record and all associated files via `storage.deleteVideoFiles(id)`. Validate ownership.

*(Moved above — registered before `/:id` to avoid route conflict.)*

---

## 6. Tus Upload Integration

### File: `apps/server/src/routes/upload.ts` (new)

### Dependencies to install:
```
pnpm -F apps/server add @tus/server @tus/file-store
```

### Integration approach:

The `@tus/server` package provides a `Server` class with a `handle(req, res)` method designed for Node.js HTTP. Since Hono on Bun uses web-standard `Request`/`Response`, we need an adapter.

**Option A (preferred)**: `@tus/server` v1.x+ may support a web `Request` interface. Check the latest docs.

**Option B (fallback)**: Create an adapter that converts between Hono's web Request and Node.js `IncomingMessage`/`ServerResponse`:

```typescript
import { Server } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { createLocalStorage } from "@video-site/storage";

const storage = createLocalStorage();

const tusServer = new Server({
  path: "/api/uploads",
  datastore: new FileStore({ directory: storage.getTusDir() }),
  maxSize: 500 * 1024 * 1024, // 500MB
  generateUrl(req, { proto, host, path, id }) {
    return `${proto}://${host}${path}/${id}`;
  },
  namingFunction(req, metadata) {
    // Use the videoId from metadata so tus ID == video DB ID
    return metadata?.videoId ?? crypto.randomUUID();
  },
  async onUploadCreate(req, res, upload) {
    // Validate auth from the request headers
    // Validate that the videoId from metadata exists in DB
    // Update video record with tusUploadId
    return res;
  },
  async onUploadFinish(req, res, upload) {
    const videoId = upload.metadata?.videoId;
    // Move file from tus temp dir to storage/videos/{videoId}/raw/
    await storage.saveRawUpload(videoId, tusUploadPath, upload.metadata.filename);
    // Update DB: status = "uploaded", rawPath, fileSize
    // In Phase 3: enqueue BullMQ transcode job here
    return res;
  },
});
```

**Mount in Hono**: Use `app.all("/api/uploads/*", ...)` to catch all tus HTTP methods (POST, PATCH, HEAD, DELETE, OPTIONS).

### CORS for tus

The tus protocol uses custom headers. Update the CORS config in `apps/server/src/index.ts`:

```typescript
cors({
  origin: env.CORS_ORIGIN,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  allowHeaders: [
    "Content-Type",
    "Authorization",
    // tus headers
    "Upload-Offset",
    "Upload-Length",
    "Upload-Metadata",
    "Upload-Concat",
    "Upload-Defer-Length",
    "Tus-Resumable",
    "Tus-Version",
    "Tus-Extension",
    "Tus-Max-Size",
  ],
  exposeHeaders: [
    "Upload-Offset",
    "Upload-Length",
    "Upload-Metadata",
    "Tus-Resumable",
    "Tus-Version",
    "Tus-Extension",
    "Tus-Max-Size",
    "Location",
  ],
  credentials: true,
})
```

---

## 7. Main App Updates

### File: `apps/server/src/index.ts` (modify)

- Add type parameter: `new Hono<{ Variables: AppVariables }>()`
- Register error handler: `app.onError(errorHandler)`
- Mount video routes: `app.route("/api/videos", videoRoutes)`
- Mount tus upload handler: `app.all("/api/uploads/*", ...)`
- Update CORS config with tus headers (see above)

---

## 8. Frontend: API Client

### File: `apps/web/src/lib/api-client.ts` (new)

Thin wrapper around `fetch` for API calls:

```typescript
import { env } from "@video-site/env/web";

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
  ) {
    super(data?.error ?? `API error ${status}`);
  }
}

export async function apiClient<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const headers: HeadersInit = { ...options?.headers };

  // Only set Content-Type for JSON bodies. Let fetch auto-set it for
  // FormData (multipart uploads) and Blob (sendBeacon payloads).
  if (
    options?.body &&
    typeof options.body === "string" &&
    !("Content-Type" in headers)
  ) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }

  const res = await fetch(`${env.VITE_SERVER_URL}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  return res.json();
}
```

---

## 9. Frontend: Upload Page

### Dependencies to install:
```
pnpm -F apps/web add tus-js-client
```

### File: `apps/web/src/routes/upload.tsx` (new)

Protected route (same auth guard pattern as `dashboard.tsx`):

```typescript
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getUser } from "@/functions/get-user";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
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

The `UploadPage` component renders the `UploadForm`.

### File: `apps/web/src/components/upload-form.tsx` (new)

Two-phase upload flow:

**Phase A — Metadata entry**:
- TanStack Form with fields: title (required), description (optional), visibility (dropdown: public/unlisted/private), tags (comma-separated input)
- File selection via `UploadDropzone` component
- Client-side validation:
  - File size <= 500MB
  - File type starts with `video/`
  - Duration <= 30 minutes (extract using `<video>` element + `URL.createObjectURL`)
  - Title 1-200 chars

**Phase B — Upload execution**:
- On form submit:
  1. `POST /api/videos` with metadata -> get `videoId`
  2. Start tus upload with `tus-js-client`:
     ```typescript
     import * as tus from "tus-js-client";

     const upload = new tus.Upload(file, {
       endpoint: `${VITE_SERVER_URL}/api/uploads`,
       retryDelays: [0, 3000, 5000, 10000, 20000],
       metadata: {
         filename: file.name,
         filetype: file.type,
         videoId: videoId,
       },
       chunkSize: 5 * 1024 * 1024, // 5MB chunks
       onProgress(bytesUploaded, bytesTotal) {
         // Update progress state
       },
       onSuccess() {
         // Navigate to video page or show processing status
       },
       onError(error) {
         // Show error toast
       },
     });
     upload.start();
     ```
  3. Show `UploadProgress` component during upload
  4. On success, show "Processing..." status (Phase 3 adds polling)

### File: `apps/web/src/components/upload-dropzone.tsx` (new)

Drag-and-drop file selection zone:
- Large dashed-border area
- Drag events: `onDragOver`, `onDragLeave`, `onDrop`
- Hidden `<input type="file" accept="video/*">` triggered by click
- Shows file name, size (formatted), and type after selection
- Visual feedback on drag hover
- Validates file type and size immediately on selection, shows inline error if invalid

### File: `apps/web/src/components/upload-progress.tsx` (new)

Progress display during upload:
- Progress bar (percentage)
- Bytes uploaded / total (formatted, e.g., "125 MB / 500 MB")
- Upload speed calculation (bytes per second, displayed as MB/s)
- ETA calculation
- Pause/Resume button (tus supports this via `upload.abort()` / `upload.start()`)
- Cancel button

### File: `apps/web/src/components/header.tsx` (modify)

Add an "Upload" button/link next to the existing nav. Only render when user is authenticated (check session from auth client). Style as a primary action button.

---

## 10. Duration Validation (Client-Side)

Before starting the upload, validate video duration on the client:

```typescript
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Could not read video metadata"));
    };
    video.src = URL.createObjectURL(file);
  });
}

// Validate: duration <= 30 * 60 (1800 seconds)
```

---

## Verification Checklist

1. **Schema push**: `pnpm db:push` creates the `video` table with all columns, enums, and indexes
2. **Create video**: `POST /api/videos` with auth returns a `videoId`
3. **Upload**: tus upload via the frontend sends chunks, file appears in `storage/temp/tus/`
4. **Upload complete**: On completion, file moves to `storage/videos/{videoId}/raw/`, DB status updates to `"uploaded"`
5. **Pause/resume**: Interrupt upload, resume -> continues from where it left off
6. **File size rejection**: Attempt 600MB file -> rejected client-side AND server-side
7. **Duration rejection**: Attempt 45-minute video -> rejected client-side
8. **List videos**: `GET /api/videos/my` returns the user's uploads
9. **CRUD**: Update title, delete video (files cleaned up)
10. **Auth guard**: Unauthenticated requests to protected endpoints return 401
11. **Ownership**: User A cannot update/delete User B's video

---

## Files Summary

| Action | File |
|--------|------|
| Create | `packages/db/src/schema/video.ts` |
| Create | `packages/db/src/schema/relations.ts` |
| Create | `packages/db/src/id.ts` |
| Create | `apps/server/src/lib/errors.ts` |
| Create | `apps/server/src/middleware/error-handler.ts` |
| Create | `apps/server/src/middleware/auth.ts` |
| Create | `apps/server/src/types.ts` |
| Create | `apps/server/src/routes/video.ts` |
| Create | `apps/server/src/routes/upload.ts` |
| Create | `apps/web/src/lib/api-client.ts` |
| Create | `apps/web/src/routes/upload.tsx` |
| Create | `apps/web/src/components/upload-form.tsx` |
| Create | `apps/web/src/components/upload-dropzone.tsx` |
| Create | `apps/web/src/components/upload-progress.tsx` |
| Modify | `packages/db/src/schema/auth.ts` (remove relations) |
| Modify | `packages/db/src/schema/index.ts` (add exports) |
| Modify | `packages/db/src/index.ts` (add generateId export) |
| Modify | `apps/server/src/index.ts` (mount routes, CORS, error handler) |
| Modify | `apps/web/src/components/header.tsx` (add Upload button) |

## Dependencies to Install

| Package | Workspace |
|---------|-----------|
| `nanoid` | `packages/db` |
| `@tus/server` | `apps/server` |
| `@tus/file-store` | `apps/server` |
| `@video-site/storage` | `apps/server` |
| `tus-js-client` | `apps/web` |
