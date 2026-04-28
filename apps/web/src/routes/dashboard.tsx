import { createFileRoute, redirect } from "@tanstack/react-router";
import { getUser } from "@/functions/get-user";

interface DashboardSearchParams {
  page?: number;
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Your videos — Watchbox" }] }),
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
