import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Layers, Loader2, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import { Input } from "@video-site/ui/components/input";
import { Label } from "@video-site/ui/components/label";

import { ApiError, apiClient } from "@/lib/api-client";

export const Route = createLazyFileRoute("/admin/categories")({
  component: AdminCategories,
});

interface AdminCategoryRow {
  id: string;
  slug: string;
  name: string;
  mode: "any" | "all";
  sortOrder: number;
  tagIds: string[];
}

interface CategoriesResponse {
  items: AdminCategoryRow[];
}

interface TagOption {
  id: string;
  slug: string;
  name: string;
}

interface TagsResponse {
  items: TagOption[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const emptyForm = {
  name: "",
  slug: "",
  mode: "any" as "any" | "all",
  tagIds: [] as string[],
};

function AdminCategories() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [slugDirty, setSlugDirty] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const { data, isLoading } = useQuery<CategoriesResponse>({
    queryKey: ["admin", "categories"],
    queryFn: () => apiClient<CategoriesResponse>("/api/admin/categories"),
  });

  const { data: tagsData } = useQuery<TagsResponse>({
    queryKey: ["admin", "tags-list"],
    queryFn: () => apiClient<TagsResponse>("/api/admin/tags"),
  });

  const items = data?.items ?? [];
  const tagOptions = tagsData?.items ?? [];
  const tagsById = new Map(tagOptions.map((t) => [t.id, t]));

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSlugDirty(false);
  };

  const upsertMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        mode: form.mode,
        tagIds: form.tagIds,
      };
      if (editingId) {
        await apiClient(`/api/admin/categories/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await apiClient("/api/admin/categories", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Category updated" : "Category created");
      resetForm();
      void queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const createTagMutation = useMutation({
    mutationFn: async (name: string): Promise<{ id: string }> => {
      const slug = slugify(name);
      if (!slug) throw new ApiError(400, "Invalid tag name");
      return apiClient<{ id: string }>("/api/admin/tags", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), slug }),
      });
    },
    onSuccess: (created) => {
      setNewTagName("");
      setForm((prev) => ({ ...prev, tagIds: [...prev.tagIds, created.id] }));
      void queryClient.invalidateQueries({ queryKey: ["admin", "tags-list"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "tags"] });
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: "up" | "down" }) =>
      apiClient(`/api/admin/categories/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ direction }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient(`/api/admin/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Category deleted");
      void queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed"),
  });

  const startEdit = (cat: AdminCategoryRow) => {
    setEditingId(cat.id);
    setForm({
      name: cat.name,
      slug: cat.slug,
      mode: cat.mode,
      tagIds: cat.tagIds,
    });
    setSlugDirty(true);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleTag = (id: string) => {
    setForm((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(id) ? prev.tagIds.filter((t) => t !== id) : [...prev.tagIds, id],
    }));
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Categories</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Categories appear in the home sidebar. Each is a set of tags combined with AND or OR.
      </p>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim() || !form.slug.trim()) return;
          upsertMutation.mutate();
        }}
        className={`mt-4 space-y-4 rounded-xl border p-4 transition-colors ${
          editingId ? "border-primary/40 bg-primary/[0.02]" : "border-border"
        }`}
      >
        {editingId && (
          <div className="text-xs font-medium uppercase tracking-wide text-primary">
            Editing category
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={form.name}
              onChange={(e) => {
                const v = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  name: v,
                  slug: slugDirty ? prev.slug : slugify(v),
                }));
              }}
              placeholder="Racing"
              className="w-48"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-slug">Slug</Label>
            <Input
              id="cat-slug"
              value={form.slug}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, slug: e.target.value }));
                setSlugDirty(true);
              }}
              placeholder="racing"
              className="w-48"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Match mode</Label>
          <div className="flex gap-2">
            {(["any", "all"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, mode: m }))}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  form.mode === m
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-muted-foreground"
                }`}
              >
                {m === "any" ? "Any (OR)" : "All (AND)"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Tags</Label>
          <div className="flex flex-wrap gap-2">
            {tagOptions.map((t) => {
              const active = form.tagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (newTagName.trim() && !createTagMutation.isPending) {
                    createTagMutation.mutate(newTagName);
                  }
                }
              }}
              placeholder="New tag name (press Enter)"
              className="h-8 max-w-xs text-sm"
              disabled={createTagMutation.isPending}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!newTagName.trim() || createTagMutation.isPending}
              onClick={() => createTagMutation.mutate(newTagName)}
            >
              {createTagMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={!form.name.trim() || !form.slug.trim() || upsertMutation.isPending}
          >
            {editingId ? (
              "Save changes"
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" /> Create category
              </>
            )}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </form>

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
            <Layers className="h-8 w-8 text-muted-foreground/30" />
            <p className="mt-2">No categories yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((c, idx) => (
              <div
                key={c.id}
                className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-secondary/30"
              >
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={idx === 0 || moveMutation.isPending}
                    onClick={() => moveMutation.mutate({ id: c.id, direction: "up" })}
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={idx === items.length - 1 || moveMutation.isPending}
                    onClick={() => moveMutation.mutate({ id: c.id, direction: "down" })}
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {c.mode === "all" ? "all" : "any"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{c.slug}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {c.tagIds.length === 0 ? (
                      <span className="text-xs text-muted-foreground">no tags</span>
                    ) : (
                      c.tagIds.map((id) => {
                        const tag = tagsById.get(id);
                        return (
                          <span
                            key={id}
                            className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {tag?.name ?? id}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => startEdit(c)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`Delete category "${c.name}"?`)) {
                      deleteMutation.mutate(c.id);
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
