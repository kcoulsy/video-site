import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {
  FileClock,
  Flag,
  Inbox,
  Layers,
  LayoutDashboard,
  MessageSquare,
  ShieldCheck,
  Tag,
  Users,
  Video,
} from "lucide-react";

import { getUser } from "@/functions/get-user";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
  beforeLoad: async () => {
    const session = await getUser();
    if (!session) throw redirect({ to: "/login" });
    const role = (session.user as { role?: string }).role;
    if (role !== "admin" && role !== "moderator") {
      throw redirect({ to: "/" });
    }
    return { session };
  },
});

function navItemsForRole(role: string | undefined) {
  const base = [
    { to: "/admin", label: "Overview", Icon: LayoutDashboard, exact: true },
    { to: "/admin/queue", label: "Queue", Icon: Inbox, exact: false },
    { to: "/admin/videos", label: "Videos", Icon: Video, exact: false },
    { to: "/admin/users", label: "Users", Icon: Users, exact: false },
    { to: "/admin/comments", label: "Comments", Icon: MessageSquare, exact: false },
    { to: "/admin/reports", label: "Reports", Icon: Flag, exact: false },
    { to: "/admin/audit", label: "Audit log", Icon: FileClock, exact: false },
  ];
  if (role === "admin") {
    base.push(
      { to: "/admin/tags", label: "Tags", Icon: Tag, exact: false },
      { to: "/admin/categories", label: "Categories", Icon: Layers, exact: false },
    );
  }
  return base;
}

function AdminLayout() {
  const { session } = Route.useRouteContext();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const navItems = navItemsForRole(role);
  return (
    <div className="mx-auto grid max-w-[1200px] gap-6 px-4 py-6 md:grid-cols-[200px_1fr]">
      <aside className="md:sticky md:top-20 md:self-start">
        <div className="mb-3 flex items-center gap-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {role === "moderator" ? "Moderator" : "Admin"}
        </div>
        <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              activeProps={{ className: "bg-secondary text-foreground" }}
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <item.Icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  );
}
