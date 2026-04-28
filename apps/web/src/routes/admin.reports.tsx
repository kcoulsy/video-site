import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Reports — Admin" }] }),
  
});
