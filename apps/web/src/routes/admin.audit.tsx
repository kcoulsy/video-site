import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({ meta: [{ title: "Audit log — Admin" }] }),
});
