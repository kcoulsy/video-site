import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

import { ForbiddenError } from "../lib/errors";
import type { AppVariables } from "../types";
import { requireAuth } from "./auth";

const requireActiveUserCheck = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const current = c.get("user");
  const [row] = await db
    .select({
      bannedAt: user.bannedAt,
      banReason: user.banReason,
      suspendedUntil: user.suspendedUntil,
      suspendReason: user.suspendReason,
      mutedAt: user.mutedAt,
      muteReason: user.muteReason,
    })
    .from(user)
    .where(eq(user.id, current.id))
    .limit(1);

  if (!row) throw new ForbiddenError("Account not found");

  if (row.bannedAt) {
    throw new ForbiddenError(row.banReason ? `Account banned: ${row.banReason}` : "Account banned");
  }

  if (row.suspendedUntil) {
    if (row.suspendedUntil > new Date()) {
      throw new ForbiddenError(
        `Account suspended until ${row.suspendedUntil.toISOString()}${row.suspendReason ? ` — ${row.suspendReason}` : ""}`,
      );
    }
    // Auto-lift expired suspension.
    await db
      .update(user)
      .set({ suspendedUntil: null, suspendReason: null, suspendedBy: null })
      .where(
        and(
          eq(user.id, current.id),
          isNotNull(user.suspendedUntil),
          lte(user.suspendedUntil, new Date()),
        ),
      );
  }

  c.set("user", { ...current, mutedAt: row.mutedAt, muteReason: row.muteReason });
  await next();
});

const requireNotMutedCheck = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const current = c.get("user");
  if (current.mutedAt) {
    throw new ForbiddenError(
      current.muteReason ? `Account muted: ${current.muteReason}` : "Account muted",
    );
  }
  await next();
});

export const requireActiveUser = [requireAuth, requireActiveUserCheck] as const;
export const requireNotMuted = [requireAuth, requireActiveUserCheck, requireNotMutedCheck] as const;
