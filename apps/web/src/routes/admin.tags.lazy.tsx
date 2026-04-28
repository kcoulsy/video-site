import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import { Loader2, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import { Input } from "@video-site/ui/components/input";
import { Label } from "@video-site/ui/components/label";

import { ApiError, apiClient } from "@/lib/api-client";

export const Route = createLazyFileRoute("/admin/tags")({
  component: AdminTags,
});

interface AdminTagRow {
  id: string;
  slug: string;
  name: string;
  videoCount: number;
  createdAt: string;
}

interface TagsResponse {
  items: AdminTagRow[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function AdminTags() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<TagsResponse>({
    queryKey: ["admin", "tags"],
    queryFn: () => apiClient<TagsResponse>("/api/admin/tags"),
  });

  const items = data?.items ?? [];

  const resetForm = () => {
    setName("");
    setSlug("");
    setSlugDirty(false);
    setEditingId(null);
  };

  const createMutation = useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      apiClient("/api/admin/tags", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Tag created");
      resetForm();
      void queryClient.invalidateQueries({ queryKey: ["admin", "tags"] });
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name: string; slug: string } }) =>
      apiClient(`/api/admin/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Tag updated");
      resetForm();
      void queryClient.invalidateQueries({ queryKey: ["admin", "tags"] });
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient(`/api/admin/tags/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Tag deleted");
      void queryClient.invalidateQueries({ queryKey: ["admin", "tags"] });
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), slug: slug.trim() };
    if (!body.name || !body.slug) return;
    if (editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const startEdit = (tag: AdminTagRow) => {
    setEditingId(tag.id);
    setName(tag.name);
    setSlug(tag.slug);
    setSlugDirty(true);
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Tags</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tags are the building blocks for categories. Uploaders pick from this set.
      </p>

      <form
        onSubmit={submit}
        className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-border p-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="tag-name">Name</Label>
          <Input
            id="tag-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugDirty) setSlug(slugify(e.target.value));
            }}
            placeholder="Formula 1"
            className="w-48"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tag-slug">Slug</Label>
          <Input
            id="tag-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugDirty(true);
            }}
            placeholder="formula1"
            className="w-48"
          />
        </div>
        <Button type="submit" disabled={!name.trim() || !slug.trim()}>
          {editingId ? (
            "Save"
          ) : (
            <>
              <Plus className="mr-1 h-4 w-4" /> Add tag
            </>
          )}
        </Button>
        {editingId && (
          <Button type="button" variant="outline" onClick={resetForm}>
            Cancel
          </Button>
        )}
      </form>

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
            <TagIcon className="h-8 w-8 text-muted-foreground/30" />
            <p className="mt-2">No tags yet — create one above.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-secondary/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.slug}</p>
                </div>
                <span className="text-xs text-muted-foreground">{t.videoCount} videos</span>
                <Button variant="ghost" size="sm" onClick={() => startEdit(t)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (
                      confirm(
                        `Delete tag "${t.name}"? It will be removed from ${t.videoCount} video(s) and any categories that reference it.`,
                      )
                    ) {
                      deleteMutation.mutate(t.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
