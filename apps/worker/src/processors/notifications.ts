import { db, generateId } from "@video-site/db";
import { notification } from "@video-site/db/schema/notification";
import { subscription } from "@video-site/db/schema/subscription";
import type { Job } from "bullmq";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import type { NotificationJobData } from "../types";

const FANOUT_BATCH = 500;

export async function processNotification(job: Job<NotificationJobData>) {
  const data = job.data;

  if (data.type === "fanout-new-upload") {
    const subs = await db
      .select({ subscriberId: subscription.subscriberId })
      .from(subscription)
      .where(eq(subscription.channelId, data.channelId));

    if (subs.length === 0) return;

    for (let i = 0; i < subs.length; i += FANOUT_BATCH) {
      const chunk = subs.slice(i, i + FANOUT_BATCH).map((s) => ({
        id: generateId(),
        recipientId: s.subscriberId,
        kind: "new_upload" as const,
        actorId: data.channelId,
        videoId: data.videoId,
      }));
      await db.insert(notification).values(chunk);
    }
    return;
  }

  if (data.type === "single") {
    if (data.coalesceWindowSec && data.coalesceWindowSec > 0) {
      const windowStart = new Date(Date.now() - data.coalesceWindowSec * 1000);
      const conds = [
        eq(notification.recipientId, data.recipientId),
        eq(notification.kind, data.kind),
        isNull(notification.readAt),
        gte(notification.createdAt, windowStart),
      ];
      if (data.videoId) conds.push(eq(notification.videoId, data.videoId));
      if (data.commentId) conds.push(eq(notification.commentId, data.commentId));

      const [exists] = await db
        .select({ x: sql<number>`1` })
        .from(notification)
        .where(and(...conds))
        .limit(1);
      if (exists) return;
    }

    await db.insert(notification).values({
      id: generateId(),
      recipientId: data.recipientId,
      kind: data.kind,
      actorId: data.actorId ?? null,
      videoId: data.videoId ?? null,
      commentId: data.commentId ?? null,
    });
  }
}
