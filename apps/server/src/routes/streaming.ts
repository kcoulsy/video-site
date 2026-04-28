import { auth } from "@video-site/auth";
import { Hono } from "hono";
import type { BunFile } from "bun";

import { storage } from "../lib/storage";
import { getStreamableVideoMeta, type StreamableVideoMeta } from "../lib/streaming-meta";
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

async function authorizePrivate(meta: StreamableVideoMeta, headers: Headers): Promise<boolean> {
  if (meta.visibility !== "private") return true;
  const session = await auth.api.getSession({ headers });
  return Boolean(session && session.user.id === meta.userId);
}

export const streamingRoutes = new Hono<{ Variables: AppVariables }>();

streamingRoutes.get("/:videoId/manifest.mpd", async (c) => {
  const videoId = c.req.param("videoId");
  if (!VIDEO_ID_RE.test(videoId)) return c.notFound();

  const meta = await getStreamableVideoMeta(videoId);
  if (!meta || meta.blocked || meta.status !== "ready" || !meta.manifestPath) {
    return c.notFound();
  }
  if (!(await authorizePrivate(meta, c.req.raw.headers))) return c.notFound();
  if (!(await storage.fileExists(meta.manifestPath))) return c.notFound();

  const file = Bun.file(meta.manifestPath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": "application/dash+xml",
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=3600",
    },
  });
});

const THUMBNAIL_VARIANT_WIDTHS = new Set([320, 640, 1280]);

function parseVariantWidth(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return THUMBNAIL_VARIANT_WIDTHS.has(n) ? n : null;
}

function preferWebp(acceptHeader: string | undefined): boolean {
  return Boolean(acceptHeader && acceptHeader.includes("image/webp"));
}

// Try a WebP variant next to a JPEG; fall back to the JPEG if the variant is missing.
// Returns the file path to serve plus its content-type, or null on miss.
async function resolveThumbnailVariant(
  jpegPath: string,
  width: number | null,
  wantWebp: boolean,
): Promise<{ filePath: string; contentType: string } | null> {
  if (wantWebp) {
    const dir = jpegPath.replace(/[/\\][^/\\]+$/, "");
    const baseName = jpegPath
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]+$/, "");
    const variantWidth = width ?? 640;
    const webpPath = `${dir}/${baseName}-${variantWidth}.webp`;
    if (await storage.fileExists(webpPath)) {
      return { filePath: webpPath, contentType: "image/webp" };
    }
  }
  if (await storage.fileExists(jpegPath)) {
    return { filePath: jpegPath, contentType: "image/jpeg" };
  }
  return null;
}

streamingRoutes.get("/:videoId/thumbnail", async (c) => {
  const videoId = c.req.param("videoId");
  if (!VIDEO_ID_RE.test(videoId)) return c.notFound();

  const meta = await getStreamableVideoMeta(videoId);
  if (!meta || meta.blocked || !meta.thumbnailPath) return c.notFound();
  if (!(await authorizePrivate(meta, c.req.raw.headers))) return c.notFound();

  const width = parseVariantWidth(c.req.query("w"));
  const wantWebp = preferWebp(c.req.header("accept"));
  const resolved = await resolveThumbnailVariant(meta.thumbnailPath, width, wantWebp);
  if (!resolved) return c.notFound();

  const file = Bun.file(resolved.filePath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": resolved.contentType,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=3600",
      Vary: "Accept",
    },
  });
});

streamingRoutes.get("/:videoId/storyboard", async (c) => {
  const videoId = c.req.param("videoId");
  if (!VIDEO_ID_RE.test(videoId)) return c.notFound();

  const meta = await getStreamableVideoMeta(videoId);
  if (!meta || meta.blocked || !meta.storyboardPath) return c.notFound();
  if (!(await authorizePrivate(meta, c.req.raw.headers))) return c.notFound();
  if (!(await storage.fileExists(meta.storyboardPath))) return c.notFound();

  const file = Bun.file(meta.storyboardPath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=31536000, immutable",
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

  const meta = await getStreamableVideoMeta(videoId);
  if (!meta || meta.blocked) return c.notFound();
  if (index >= meta.thumbnailStillsCount) return c.notFound();
  if (!(await authorizePrivate(meta, c.req.raw.headers))) return c.notFound();

  const jpegPath = storage.resolve("videos", videoId, "thumbnails", `still-${index}.jpg`);
  const width = parseVariantWidth(c.req.query("w"));
  const wantWebp = preferWebp(c.req.header("accept"));
  const resolved = await resolveThumbnailVariant(jpegPath, width, wantWebp);
  if (!resolved) return c.notFound();

  const file = Bun.file(resolved.filePath);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": resolved.contentType,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=3600",
      Vary: "Accept",
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
