import path from "node:path";

import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { auth } from "@video-site/auth";
import { db } from "@video-site/db";
import { video } from "@video-site/db/schema/video";
import { eq } from "drizzle-orm";

import { transcodeQueue } from "../lib/queue";
import { storage } from "../lib/storage";

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
    const filename = upload.metadata?.filename ?? `${videoId}.bin`;
    const rawPath = await storage.saveRawUpload(videoId, tusFilePath, filename);

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
