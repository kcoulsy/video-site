import { env } from "@video-site/env/server";
import { createMiddleware } from "hono/factory";

import { ForbiddenError } from "../lib/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const expectedOrigin = new URL(env.CORS_ORIGIN).origin;

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// CSRF defense: cookies are SameSite=None, so any cross-site page can attach
// them to a state-changing request. Reject unsafe methods unless the Origin
// (or Referer fallback) matches our trusted frontend.
export const originCheck = createMiddleware(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const origin = c.req.header("origin");
  const candidate = origin ?? c.req.header("referer");
  const candidateOrigin = originOf(candidate);

  if (!candidateOrigin || candidateOrigin !== expectedOrigin) {
    throw new ForbiddenError("Cross-origin request blocked");
  }

  await next();
});
