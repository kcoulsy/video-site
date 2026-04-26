import { createMiddleware } from "hono/factory";

import { ForbiddenError } from "../lib/errors";
import type { AppVariables } from "../types";
import { requireAuth } from "./auth";

const requireAdminCheck = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const currentUser = c.get("user");
  if (currentUser.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
  await next();
});

export const requireAdmin = [requireAuth, requireAdminCheck] as const;
