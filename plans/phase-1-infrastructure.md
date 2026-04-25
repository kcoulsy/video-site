# Phase 1: Infrastructure & Storage Foundation

## Overview

Set up Docker Compose for PostgreSQL and Redis, create the shared storage utility package, add Redis connection configuration, and extend environment variables. This phase delivers zero user-facing features but establishes the infrastructure every subsequent phase depends on.

## Prerequisites

- FFmpeg and FFprobe installed on the development machine (needed in Phase 3 but good to verify now)
- Docker Desktop installed and running

---

## 1. Docker Compose

### File: `docker-compose.yml` (project root)

Define two services with named volumes and a shared network:

**PostgreSQL 16**:
- Image: `postgres:16-alpine`
- Port: `5432:5432`
- Environment: `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=password`, `POSTGRES_DB=postgres`
- Volume: `pgdata:/var/lib/postgresql/data`
- Healthcheck: `pg_isready -U postgres`

**Redis 7**:
- Image: `redis:7-alpine`
- Port: `6379:6379`
- Command: `redis-server --maxmemory-policy noeviction` (required for BullMQ — it needs Redis to never evict keys)
- Volume: `redisdata:/data`
- Healthcheck: `redis-cli ping`

**Network**: `video-site-network` (bridge)

**Volumes**: `pgdata`, `redisdata` (both named, persist across restarts)

### Root `package.json` — add scripts:
```json
"docker:up": "docker compose up -d",
"docker:down": "docker compose down",
"docker:reset": "docker compose down -v"
```

---

## 2. Storage Utility Package

### Package: `packages/storage`

This is a new shared package that all apps (`server`, `worker`) will use for file I/O.

### File: `packages/storage/package.json`

```json
{
  "name": "@video-site/storage",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@video-site/env": "workspace:*"
  },
  "devDependencies": {
    "@video-site/config": "workspace:*",
    "typescript": "catalog:"
  }
}
```

### File: `packages/storage/tsconfig.json`

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

### File: `packages/storage/src/index.ts`

Exports the `StorageService` interface and the `createLocalStorage` factory function.

```typescript
export interface StorageService {
  // Raw upload management
  saveRawUpload(videoId: string, sourceFile: string, filename: string): Promise<string>;
  getRawUploadPath(videoId: string): string;

  // Transcoded output
  getTranscodedDir(videoId: string): string;
  ensureTranscodedDir(videoId: string): Promise<string>;

  // Thumbnails
  saveThumbnail(videoId: string, data: Buffer | Uint8Array, filename?: string): Promise<string>;
  getThumbnailPath(videoId: string): string;

  // Reading / streaming
  createReadStream(filePath: string): ReadableStream;
  getFileSize(filePath: string): Promise<number>;
  fileExists(filePath: string): Promise<boolean>;

  // Cleanup
  deleteVideoFiles(videoId: string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;

  // Path resolution
  getVideoDir(videoId: string): string;
  getTusDir(): string;
  resolve(...segments: string[]): string;
}

export { createLocalStorage } from "./local-storage";
```

### File: `packages/storage/src/local-storage.ts`

Implementation details:

**Base directory**: Configurable via `STORAGE_PATH` env var. Must be an absolute path (no default — require it to be set explicitly). In a monorepo, `process.cwd()` varies depending on which app runs, so relative defaults like `./storage` resolve to different locations from `apps/server` vs `apps/worker`.

**Directory structure** created on-demand:
```
storage/
  videos/
    {videoId}/
      raw/            # original uploaded file (e.g., raw/my-video.mp4)
      transcoded/     # DASH segments and manifests
      thumbnails/     # auto-generated and custom thumbnails
  temp/
    tus/              # tus upload scratch space (incomplete uploads)
```

**Key implementation notes**:

- Use `Bun.file()` and `Bun.write()` for I/O (the project runs on Bun)
- `createReadStream(filePath)` returns `Bun.file(filePath).stream()` — a web-standard `ReadableStream` compatible with Hono responses
- `getFileSize(filePath)` returns `Bun.file(filePath).size`
- `fileExists(filePath)` uses `Bun.file(filePath).exists()` 
- `deleteVideoFiles(videoId)` removes the entire `videos/{videoId}/` directory recursively using `fs.promises.rm(path, { recursive: true, force: true })`
- `saveRawUpload(videoId, sourceFile, filename)` moves/copies a file from the tus temp directory to `videos/{videoId}/raw/{filename}`. Use `fs.promises.rename()` for same-filesystem moves, fall back to copy+delete
- `ensureTranscodedDir(videoId)` creates `videos/{videoId}/transcoded/` and returns the absolute path — the FFmpeg worker needs this as the output directory
- All methods that write ensure parent directories exist via `fs.promises.mkdir(dir, { recursive: true })`
- All stored/returned paths use forward slashes for cross-platform consistency (important on Windows)
- The `resolve(...segments)` method joins segments relative to the base directory

**Singleton pattern**: Export a `createLocalStorage(basePath?: string)` factory. The consuming app creates one instance at startup:

```typescript
import { createLocalStorage } from "@video-site/storage";
export const storage = createLocalStorage(env.STORAGE_PATH);
```

---

## 3. Environment Variable Updates

### File: `packages/env/src/server.ts` (modify)

Add to the `server` object in `createEnv`:

```typescript
REDIS_URL: z.string().default("redis://localhost:6379"),
STORAGE_PATH: z.string().min(1),  // absolute path, required — no safe default in a monorepo
```

### File: `packages/env/src/worker.ts` (new)

Create a worker-specific env validation file:

```typescript
import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    STORAGE_PATH: z.string().min(1),  // absolute path, required — no safe default in a monorepo
    FFMPEG_PATH: z.string().default("ffmpeg"),
    FFPROBE_PATH: z.string().default("ffprobe"),
    CONCURRENCY: z.coerce.number().default(2),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

### File: `packages/env/package.json` (modify)

Add the worker export:

```json
"exports": {
  "./server": "./src/server.ts",
  "./web": "./src/web.ts",
  "./worker": "./src/worker.ts"
}
```

---

## 4. Gitignore Update

### File: `.gitignore` (modify)

Add:

```
# Video storage (local dev)
storage/
```

---

## 5. Server `.env` Update

### File: `apps/server/.env` (modify)

Add:

```
REDIS_URL=redis://localhost:6379
STORAGE_PATH=C:/Users/you/projects/video-site/storage  # absolute path, required
```

### File: `apps/worker/.env` (create — needed in Phase 3 but can stub now)

```
DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
REDIS_URL=redis://localhost:6379
STORAGE_PATH=C:/Users/you/projects/video-site/storage  # absolute path, required
# FFMPEG_PATH=ffmpeg
# FFPROBE_PATH=ffprobe
# CONCURRENCY=2
```

---

## 6. pnpm Workspace

The existing `pnpm-workspace.yaml` already includes `packages/*`, so `packages/storage` will be auto-discovered. No changes needed.

---

## Verification Checklist

1. `docker compose up -d` starts both PostgreSQL and Redis without errors
2. `docker compose ps` shows both services as healthy
3. `redis-cli ping` returns `PONG`
4. `pnpm install` from the root picks up `@video-site/storage`
5. Importing `@video-site/storage` in apps/server resolves without errors
6. Importing `@video-site/env/server` still works with the new `REDIS_URL` field
7. Importing `@video-site/env/worker` works
8. The `storage/` directory is gitignored
9. Run `pnpm check-types` — no TypeScript errors

---

## Files Summary

| Action | File |
|--------|------|
| Create | `docker-compose.yml` |
| Create | `packages/storage/package.json` |
| Create | `packages/storage/tsconfig.json` |
| Create | `packages/storage/src/index.ts` |
| Create | `packages/storage/src/local-storage.ts` |
| Create | `packages/env/src/worker.ts` |
| Create | `apps/worker/.env` |
| Modify | `packages/env/src/server.ts` |
| Modify | `packages/env/package.json` |
| Modify | `.gitignore` |
| Modify | `apps/server/.env` |
| Modify | root `package.json` (docker scripts) |

## Dependencies to Install

None in this phase — all storage code uses Node.js builtins and Bun APIs.
