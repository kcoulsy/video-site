import { env } from "@video-site/env/server";
import IORedis from "ioredis";

let redis: IORedis | null = null;

export function getRedisClient(): IORedis {
  if (!redis) {
    redis = new IORedis(env.REDIS_URL);
  }
  return redis;
}
