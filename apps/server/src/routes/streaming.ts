import { auth } from "@video-site/auth";
import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { video } from "@video-site/db/schema/video";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { BunFile } from "bun";

import { storage } from "../lib/storage";
import type { AppVariables } from "../types";

const SEGMENT_FILENAME_RE = /^(init-stream\d+|chunk-stream\d+-\d{5,})\.m4s$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{21}$/;

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mpd":
      return "application/dash+xml";
    case "m4s":
      return "video/iso.segment";
    case "mp4":
      return "video/mp4";
    case "m4a":
      return "audio/mp4";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function handleRangeRequest(file: BunFile, rangeHeader: string, contentType: string): Response {
  const fileSize = file.size;
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return new Response("Invalid Range", { status: 416 });
  }

  const start = parseInt(match[1]!, 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (start >= fileSize || end >= fileSize || start > end) {
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

export const streamingRoutes = new Hono<{ Variables: AppVariables }>();

streamingRoutes.get("/:videoId/manifest.mpd", async (c) => {
  const videoId = c.req.param("videoId");
  if (!VIDEO_ID_RE.test(videoId)) return c.notFound();

  const [row] = await db
    .select({
      manifestPath: video.manifestPath,
      visibility: video.visibility,
      userId: video.userId,
      deletedAt: video.deletedAt,
      authorBannedAt: user.bannedAt,
      authorSuspendedUntil: user.suspendedUntil,
    })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(and(eq(video.id, videoId), eq(video.status, "ready"), isNull(video.deletedAt)))
    .limit(1);

  if (!row || !row.manifestPath) return c.notFound();
  if (row.authorBannedAt) return c.notFound();
  if (row.authorSuspendedUntil && row.authorSuspendedUntil > new Date()) return c.notFound();

  if (row.visibility === "private") {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session || session.user.id !== row.userId) {
      return c.notFound();
    }
  }

  if (!(await storage.fileExists(row.manifestPath))) return c.notFound();

  const file = Bun.file(row.manifestPath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": "application/dash+xml",
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=5",
    },
  });
});

streamingRoutes.get("/:videoId/thumbnail", async (c) => {
  const videoId = c.req.param("videoId");
  if (!VIDEO_ID_RE.test(videoId)) return c.notFound();

  const [row] = await db
    .select({
      thumbnailPath: video.thumbnailPath,
      visibility: video.visibility,
      userId: video.userId,
      deletedAt: video.deletedAt,
      authorBannedAt: user.bannedAt,
      authorSuspendedUntil: user.suspendedUntil,
    })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(eq(video.id, videoId))
    .limit(1);

  if (!row || !row.thumbnailPath) return c.notFound();
  if (row.deletedAt) return c.notFound();
  if (row.authorBannedAt) return c.notFound();
  if (row.authorSuspendedUntil && row.authorSuspendedUntil > new Date()) return c.notFound();

  if (row.visibility === "private") {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session || session.user.id !== row.userId) {
      return c.notFound();
    }
  }

  if (!(await storage.fileExists(row.thumbnailPath))) return c.notFound();

  const file = Bun.file(row.thumbnailPath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=3600",
    },
  });
});

streamingRoutes.get("/:videoId/thumbnail/still/:index", async (c) => {
  const videoId = c.req.param("videoId");
  if (!VIDEO_ID_RE.test(videoId)) return c.notFound();
  const indexStr = c.req.param("index");
  const index = Number.parseInt(indexStr, 10);
  if (!Number.isInteger(index) || index < 0 || index > 99) {
    return c.json({ error: "Invalid index" }, 400);
  }

  const [row] = await db
    .select({
      stillsCount: video.thumbnailStillsCount,
      visibility: video.visibility,
      userId: video.userId,
      deletedAt: video.deletedAt,
      authorBannedAt: user.bannedAt,
      authorSuspendedUntil: user.suspendedUntil,
    })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(eq(video.id, videoId))
    .limit(1);

  if (!row) return c.notFound();
  if (index >= row.stillsCount) return c.notFound();
  if (row.deletedAt) return c.notFound();
  if (row.authorBannedAt) return c.notFound();
  if (row.authorSuspendedUntil && row.authorSuspendedUntil > new Date()) return c.notFound();

  if (row.visibility === "private") {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session || session.user.id !== row.userId) {
      return c.notFound();
    }
  }

  const filePath = storage.resolve("videos", videoId, "thumbnails", `still-${index}.jpg`);
  if (!(await storage.fileExists(filePath))) return c.notFound();

  const file = Bun.file(filePath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=3600",
    },
  });
});

streamingRoutes.get("/:videoId/:filename", async (c) => {
  const { videoId, filename } = c.req.param();

  if (!VIDEO_ID_RE.test(videoId)) {
    return c.json({ error: "Invalid videoId" }, 400);
  }
  if (!SEGMENT_FILENAME_RE.test(filename)) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const filePath = storage.resolve("videos", videoId, "transcoded", filename);
  if (!(await storage.fileExists(filePath))) return c.notFound();

  const file = Bun.file(filePath);
  const contentType = getContentType(filename);

  const range = c.req.header("Range");
  if (range) {
    return handleRangeRequest(file, range, contentType);
  }

  return new Response(file.stream(), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    },
  });
});
