import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { AppError } from "../lib/errors";

export function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code, ...err.details },
      err.statusCode as ContentfulStatusCode,
    );
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
}
