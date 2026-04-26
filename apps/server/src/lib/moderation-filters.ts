import { user } from "@video-site/db/schema/auth";
import { comment } from "@video-site/db/schema/comment";
import { video } from "@video-site/db/schema/video";
import { sql } from "drizzle-orm";

export const visibleVideoWhere = () => sql`${video.deletedAt} IS NULL`;
export const visibleCommentWhere = () => sql`${comment.removedBy} IS NULL`;

export const activeAuthorWhere = () =>
  sql`${user.bannedAt} IS NULL AND (${user.suspendedUntil} IS NULL OR ${user.suspendedUntil} < NOW())`;
