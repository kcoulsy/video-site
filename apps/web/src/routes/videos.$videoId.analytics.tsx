import { createFileRoute, redirect } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { getUser } from "@/functions/get-user";

export const Route = createFileRoute("/videos/$videoId/analytics")({
  head: () => ({ meta: [{ title: `Video analytics — ${env.VITE_APP_NAME}` }] }),
  beforeLoad: async () => {
    const session = await getUser();
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
});
