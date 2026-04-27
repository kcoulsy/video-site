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
    FFMPEG_PATH: z.string().default("ffmpeg"),
    FFPROBE_PATH: z.string().default("ffprobe"),
    CONCURRENCY: z.coerce.number().default(2),
    DELETE_RAW_AFTER_TRANSCODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
