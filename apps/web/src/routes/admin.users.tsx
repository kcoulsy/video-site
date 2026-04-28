import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Manage users — Admin" }] }),
  
});
