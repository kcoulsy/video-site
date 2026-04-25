import { auth } from "@video-site/auth";
import { env } from "@video-site/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { errorHandler } from "./middleware/error-handler";
import { commentRoutes } from "./routes/comment";
import { streamingRoutes } from "./routes/streaming";
import { handleTusRequest } from "./routes/upload";
import { videoRoutes } from "./routes/video";
import type { AppVariables } from "./types";

const app = new Hono<{ Variables: AppVariables }>();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Upload-Offset",
      "Upload-Length",
      "Upload-Metadata",
      "Upload-Concat",
      "Upload-Defer-Length",
      "Tus-Resumable",
      "Tus-Version",
      "Tus-Extension",
      "Tus-Max-Size",
    ],
    exposeHeaders: [
      "Upload-Offset",
      "Upload-Length",
      "Upload-Metadata",
      "Tus-Resumable",
      "Tus-Version",
      "Tus-Extension",
      "Tus-Max-Size",
      "Location",
    ],
    credentials: true,
  }),
);

app.onError(errorHandler);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/videos", videoRoutes);
app.route("/api/stream", streamingRoutes);
app.route("/api", commentRoutes);

app.all("/api/uploads", (c) => handleTusRequest(c.req.raw));
app.all("/api/uploads/*", (c) => handleTusRequest(c.req.raw));

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
