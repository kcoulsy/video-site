import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/videos")({
  head: () => ({ meta: [{ title: "Manage videos — Admin" }] }),
  
});
