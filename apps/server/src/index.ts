import { auth } from "@video-site/auth";
import { env } from "@video-site/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { errorHandler } from "./middleware/error-handler";
import { adminRoutes } from "./routes/admin";
import { analyticsRoutes } from "./routes/analytics";
import { commentRoutes } from "./routes/comment";
import { commentLikeRoutes } from "./routes/comment-like";
import { likeRoutes } from "./routes/like";
import { moderationRoutes } from "./routes/moderation";
import { playlistRoutes } from "./routes/playlist";
import { searchRoutes } from "./routes/search";
import { streamingRoutes } from "./routes/streaming";
import { tagRoutes } from "./routes/tags";
import { handleTusRequest } from "./routes/upload";
import { videoRoutes } from "./routes/video";
import { watchHistoryRoutes } from "./routes/watch-history";
import { watchLaterRoutes } from "./routes/watch-later";
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

app.route("/api/admin", adminRoutes);
app.route("/api/moderation", moderationRoutes);
app.route("/api/videos", videoRoutes);
app.route("/api/videos", likeRoutes);
app.route("/api/stream", streamingRoutes);
app.route("/api/search", searchRoutes);
app.route("/api", tagRoutes);
app.route("/api", commentRoutes);
app.route("/api", commentLikeRoutes);
app.route("/api", watchHistoryRoutes);
app.route("/api", watchLaterRoutes);
app.route("/api", playlistRoutes);
app.route("/api", analyticsRoutes);

app.all("/api/uploads", (c) => handleTusRequest(c.req.raw));
app.all("/api/uploads/*", (c) => handleTusRequest(c.req.raw));

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
