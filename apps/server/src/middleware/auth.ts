import { auth } from "@video-site/auth";
import { createMiddleware } from "hono/factory";

import type { AppVariables } from "../types";

export const requireAuth = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});
