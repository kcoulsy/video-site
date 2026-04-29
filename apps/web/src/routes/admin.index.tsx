import { createFileRoute } from "@tanstack/react-router";
import { env } from "@video-site/env/web";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: `Admin overview — ${env.VITE_APP_NAME}` }] }),
});
