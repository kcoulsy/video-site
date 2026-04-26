import { createMiddleware } from "hono/factory";

import { ForbiddenError } from "../lib/errors";
import type { AppVariables } from "../types";
import { requireAuth } from "./auth";

const requireModeratorCheck = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const currentUser = c.get("user");
  if (currentUser.role !== "admin" && currentUser.role !== "moderator") {
    throw new ForbiddenError("Moderator access required");
  }
  await next();
});

export const requireModerator = [requireAuth, requireModeratorCheck] as const;
