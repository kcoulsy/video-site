import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    STORAGE_PATH: z.string().min(1),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // When true, trust X-Forwarded-For / X-Real-IP for the client IP. Only enable
    // when the server is behind a proxy you control (Nginx, Caddy, Cloudflare).
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
