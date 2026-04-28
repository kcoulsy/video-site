import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/tags")({
  head: () => ({ meta: [{ title: "Tags — Admin" }] }),
  
});
