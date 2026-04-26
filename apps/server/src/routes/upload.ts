import path from "node:path";

import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { auth } from "@video-site/auth";
import { db } from "@video-site/db";
import { video } from "@video-site/db/schema/video";
import { eq } from "drizzle-orm";

import { AppError } from "../lib/errors";
import { detectVideoFile } from "../lib/file-validation";
import { transcodeQueue } from "../lib/queue";
import { storage } from "../lib/storage";
import { assertHashAllowed } from "../lib/upload-guard";

async function hashFile(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const file = Bun.file(filePath);
  for await (const chunk of file.stream()) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

async function failVideo(videoId: string, reason: string): Promise<void> {
  await db
    .update(video)
    .set({ status: "failed", processingError: reason })
    .where(eq(video.id, videoId));
  await storage.deleteVideoFiles(videoId).catch((err: unknown) => {
    console.error(`failed to clean up files for ${videoId}:`, err);
  });
}

const MAX_UPLOAD_SIZE = 500 * 1024 * 1024;

const tusServer = new Server({
  path: "/api/uploads",
  datastore: new FileStore({ directory: storage.getTusDir() }),
  maxSize: MAX_UPLOAD_SIZE,
  namingFunction(_req, metadata) {
    const videoId = metadata?.videoId;
    if (!videoId) {
      throw new Error("videoId is required in upload metadata");
    }
    return videoId;
  },
  async onUploadCreate(req, upload) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      throw { status_code: 401, body: "Unauthorized" };
    }

    const videoId = upload.metadata?.videoId;
    if (!videoId) {
      throw { status_code: 400, body: "videoId is required" };
    }

    const [existing] = await db
      .select({ userId: video.userId, status: video.status })
      .from(video)
      .where(eq(video.id, videoId))
      .limit(1);

    if (!existing) {
      throw { status_code: 404, body: "Video not found" };
    }
    if (existing.userId !== session.user.id) {
      throw { status_code: 403, body: "Forbidden" };
    }
    if (existing.status !== "uploading") {
      throw { status_code: 409, body: "Upload already finished" };
    }

    await db.update(video).set({ tusUploadId: videoId }).where(eq(video.id, videoId));

    return {};
  },
  async onUploadFinish(_req, upload) {
    const videoId = upload.metadata?.videoId;
    if (!videoId) {
      throw { status_code: 400, body: "videoId is required" };
    }

    const tusFilePath = path.posix.join(storage.getTusDir(), upload.id);

    try {
      await detectVideoFile(tusFilePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid video file";
      await db
        .update(video)
        .set({ status: "failed", processingError: message })
        .where(eq(video.id, videoId));
      await storage.deleteFile(tusFilePath).catch(() => {});
      throw { status_code: 415, body: message };
    }

    const filename = upload.metadata?.filename ?? `${videoId}.bin`;
    const rawPath = await storage.saveRawUpload(videoId, tusFilePath, filename);

    const [row] = await db
      .select({ fileHash: video.fileHash, userId: video.userId })
      .from(video)
      .where(eq(video.id, videoId))
      .limit(1);

    if (!row) {
      await storage.deleteVideoFiles(videoId).catch(() => {});
      throw { status_code: 404, body: "Video not found" };
    }

    const actualHash = await hashFile(rawPath);

    if (row.fileHash && row.fileHash !== actualHash) {
      await failVideo(videoId, "hash_mismatch");
      throw { status_code: 400, body: "Uploaded file does not match the declared hash." };
    }

    try {
      await assertHashAllowed(actualHash, {
        uploaderId: row.userId,
        excludeVideoId: videoId,
      });
    } catch (err) {
      await failVideo(videoId, err instanceof AppError ? (err.code ?? "duplicate") : "duplicate");
      if (err instanceof AppError) {
        throw { status_code: err.statusCode, body: err.message };
      }
      throw err;
    }

    const [updated] = await db
      .update(video)
      .set({
        status: "uploaded",
        rawPath,
        fileSize: upload.size ?? null,
      })
      .where(eq(video.id, videoId))
      .returning({ userId: video.userId });

    if (updated) {
      await transcodeQueue.add(
        "transcode",
        { videoId, rawPath, userId: updated.userId },
        { jobId: videoId },
      );
    }

    return {};
  },
});

export const handleTusRequest = (req: Request) => tusServer.handleWeb(req);
