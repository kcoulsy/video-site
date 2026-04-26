import { db, generateId } from "@video-site/db";
import { moderationAction } from "@video-site/db/schema/moderation";

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type ModerationActionName =
  | "ban"
  | "unban"
  | "suspend"
  | "unsuspend"
  | "mute"
  | "unmute"
  | "remove_video"
  | "restore_video"
  | "hard_delete_video"
  | "remove_comment"
  | "restore_comment"
  | "hard_delete_comment"
  | "role_change"
  | "delete_user"
  | "resolve_report"
  | "dismiss_report";

type ModerationTarget = "user" | "video" | "comment" | "report";

export async function logModerationAction(
  tx: Tx,
  params: {
    actorId: string;
    action: ModerationActionName;
    targetType: ModerationTarget;
    targetId: string;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  await tx.insert(moderationAction).values({
    id: generateId(),
    actorId: params.actorId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    reason: params.reason ?? null,
    metadata: params.metadata ?? null,
  });
}
