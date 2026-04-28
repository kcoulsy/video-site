import { env } from "@video-site/env/server";
import type { Context } from "hono";
import { getConnInfo } from "hono/adapter/bun/conninfo";
import { createMiddleware } from "hono/factory";

import { AppError } from "../lib/errors";
import { getRedisClient } from "../lib/redis";
import type { AppUser } from "../types";

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, "Too many requests", "RATE_LIMITED", { retryAfter: retryAfterSeconds });
  }
}

interface RateLimitOptions {
  /** Bucket name — distinct buckets are rate-limited independently. */
  name: string;
  limit: number;
  windowSeconds: number;
}

function clientIdent(c: Context): string {
  const user = c.get("user") as AppUser | undefined;
  if (user?.id) return `u:${user.id}`;
  // Only honor proxy headers when the deployment explicitly opts in via TRUST_PROXY.
  // Otherwise an unauthenticated caller could rotate X-Forwarded-For to bypass per-IP buckets.
  if (env.TRUST_PROXY) {
    const fwd = c.req.header("x-forwarded-for");
    const ip = fwd?.split(",")[0]?.trim() || c.req.header("x-real-ip");
    if (ip) return `ip:${ip}`;
  }
  try {
    const info = getConnInfo(c);
    if (info.remote.address) return `ip:${info.remote.address}`;
  } catch {
    // adapter not available (e.g. tests) — fall through
  }
  return "ip:anon";
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    const redis = getRedisClient();
    const key = `rl:${opts.name}:${clientIdent(c)}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, opts.windowSeconds);
    }
    if (count > opts.limit) {
      const ttl = await redis.ttl(key);
      const retryAfter = ttl > 0 ? ttl : opts.windowSeconds;
      c.header("Retry-After", String(retryAfter));
      throw new RateLimitError(retryAfter);
    }
    c.header("X-RateLimit-Limit", String(opts.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, opts.limit - count)));
    await next();
  });
}
