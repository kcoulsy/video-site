import { db } from "@video-site/db";
import { removedVideoHash, video } from "@video-site/db/schema/video";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import { AppError } from "./errors";

export interface AssertHashOptions {
  excludeVideoId?: string;
  uploaderId: string;
}

export async function assertHashAllowed(
  hash: string,
  { excludeVideoId, uploaderId }: AssertHashOptions,
): Promise<void> {
  const [blocked] = await db
    .select({ hash: removedVideoHash.hash })
    .from(removedVideoHash)
    .where(eq(removedVideoHash.hash, hash))
    .limit(1);

  if (blocked) {
    throw new AppError(
      409,
      "This video has been removed by a moderator and cannot be re-uploaded.",
      "removed_by_moderator",
    );
  }

  const liveStatuses = ["uploaded", "processing", "ready"] as const;
  const conflictWhere = excludeVideoId
    ? and(
        eq(video.fileHash, hash),
        isNull(video.deletedAt),
        inArray(video.status, liveStatuses),
        ne(video.id, excludeVideoId),
      )
    : and(
        eq(video.fileHash, hash),
        isNull(video.deletedAt),
        inArray(video.status, liveStatuses),
      );

  const [existing] = await db
    .select({
      id: video.id,
      userId: video.userId,
      visibility: video.visibility,
      removedBy: video.removedBy,
    })
    .from(video)
    .where(conflictWhere)
    .limit(1);

  if (existing) {
    const isOwn = existing.userId === uploaderId;
    const canLink = isOwn || existing.visibility !== "private";
    throw new AppError(
      409,
      "This video has already been uploaded.",
      "duplicate",
      canLink ? { existingVideoId: existing.id } : undefined,
    );
  }

  // Belt-and-braces: also reject when a soft-deleted-by-mod row matches but the
  // blocklist row was somehow not written (legacy data prior to backfill).
  const [softRemoved] = await db
    .select({ id: video.id })
    .from(video)
    .where(and(eq(video.fileHash, hash), isNotNull(video.removedBy)))
    .limit(1);

  if (softRemoved && softRemoved.id !== excludeVideoId) {
    throw new AppError(
      409,
      "This video has been removed by a moderator and cannot be re-uploaded.",
      "removed_by_moderator",
    );
  }
}
