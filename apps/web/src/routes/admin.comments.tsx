import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/comments")({
  head: () => ({ meta: [{ title: "Manage comments — Admin" }] }),
  
});
