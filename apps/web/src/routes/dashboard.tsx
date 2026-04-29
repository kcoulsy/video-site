import { createFileRoute, redirect } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { getUser } from "@/functions/get-user";

interface DashboardSearchParams {
  page?: number;
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: `Your videos — ${env.VITE_APP_NAME}` }] }),
  beforeLoad: async () => {
    const session = await getUser();
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
  validateSearch: (search: Record<string, unknown>): DashboardSearchParams => {
    const pageNum = Number(search.page);
    const page = Number.isFinite(pageNum) && pageNum > 1 ? Math.floor(pageNum) : undefined;
    return { page };
  },
});
