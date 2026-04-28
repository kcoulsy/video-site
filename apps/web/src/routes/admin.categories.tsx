import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({ meta: [{ title: "Categories — Admin" }] }),
});
