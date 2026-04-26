import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { Button } from "@video-site/ui/components/button";
import { Input } from "@video-site/ui/components/input";
import { Label } from "@video-site/ui/components/label";
import { ArrowLeft, Eye, EyeOff, Film, Loader2, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import * as tus from "tus-js-client";

import { getUser } from "@/functions/get-user";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatFileSize } from "@/lib/format";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
  beforeLoad: async () => {
    const session = await getUser();
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
});

interface CreateVideoResponse {
  id: string;
  uploadUrl: string;
}

interface TagOption {
  id: string;
  slug: string;
  name: string;
}

interface TagsResponse {
  items: TagOption[];
}

function UploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const { data: tagData } = useQuery<TagsResponse>({
    queryKey: ["tags"],
    queryFn: () => apiClient<TagsResponse>("/api/tags"),
    staleTime: 5 * 60 * 1000,
  });
  const tagOptions = tagData?.items ?? [];
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing">("idle");
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<tus.Upload | null>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped?.type.startsWith("video/")) {
        setFile(dropped);
        if (!title) setTitle(dropped.name.replace(/\.[^.]+$/, ""));
      }
    },
    [title],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) {
        setFile(selected);
        if (!title) setTitle(selected.name.replace(/\.[^.]+$/, ""));
      }
    },
    [title],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!file) return;
      setPhase("uploading");
      setProgress(0);

      let videoId: string;
      try {
        const created = await apiClient<CreateVideoResponse>("/api/videos", {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            visibility,
            tagIds: selectedTagIds,
            filename: file.name,
            mimeType: file.type || "video/mp4",
            fileSize: file.size,
          }),
        });
        videoId = created.id;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Failed to create video record";
        toast.error(msg);
        setPhase("idle");
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: `${env.VITE_SERVER_URL}/api/uploads`,
          retryDelays: [0, 1000, 3000, 5000],
          chunkSize: 8 * 1024 * 1024,
          onBeforeRequest: (req) => {
            const xhr = req.getUnderlyingObject() as XMLHttpRequest;
            xhr.withCredentials = true;
          },
          metadata: {
            videoId,
            filename: file.name,
            filetype: file.type || "video/mp4",
          },
          onError: (err) => reject(err),
          onProgress: (bytesUploaded, bytesTotal) => {
            const pct = Math.round((bytesUploaded / bytesTotal) * 100);
            setProgress(pct);
            if (pct >= 100) setPhase("processing");
          },
          onSuccess: () => resolve(),
        });
        uploadRef.current = upload;
        upload.start();
      })
        .then(() => {
          toast.success("Upload complete — processing in the background");
          void queryClient.invalidateQueries({ queryKey: ["videos", "my"] });
          void navigate({ to: "/dashboard" });
        })
        .catch((err: Error) => {
          toast.error(`Upload failed: ${err.message}`);
          setPhase("idle");
        });
    },
    [file, title, description, selectedTagIds, visibility, navigate, queryClient],
  );

  const isUploading = phase === "uploading";
  const isProcessing = phase === "processing";
  const isBusy = isUploading || isProcessing;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button
        type="button"
        onClick={() => navigate({ to: "/dashboard" })}
        disabled={isUploading}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Upload Video</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your video with the world.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {!file ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <Upload
              className={`mb-4 h-10 w-10 ${dragOver ? "text-primary" : "text-muted-foreground"}`}
            />
            <p className="text-sm font-medium">
              {dragOver ? "Drop video here" : "Drag & drop a video file"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        ) : (
          <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/30 p-4">
            <Film className="h-8 w-8 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            </div>
            {!isBusy && (
              <button
                type="button"
                onClick={() => setFile(null)}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {isUploading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Uploading...</span>
              <span className="font-medium text-primary tabular-nums">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">Upload complete — processing</p>
              <p className="text-xs text-muted-foreground">
                We're transcoding your video in the background. You can leave this page and keep
                browsing.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="upload-title">Title</Label>
          <Input
            id="upload-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give your video a title"
            disabled={isBusy}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="upload-desc">Description</Label>
          <textarea
            id="upload-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell viewers about your video"
            rows={4}
            disabled={isBusy}
            className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
          />
        </div>

        <div className="space-y-2">
          <Label>Tags</Label>
          {tagOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tags available yet. An admin needs to create tags before they can be applied.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagOptions.map((t) => {
                const active = selectedTagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setSelectedTagIds((prev) =>
                        prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                      )
                    }
                    disabled={isBusy}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
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
          )}
        </div>

        <div className="space-y-2">
          <Label>Visibility</Label>
          <div className="flex gap-2">
            {(["public", "unlisted", "private"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                disabled={isBusy}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm capitalize transition-colors disabled:opacity-50 ${
                  visibility === v
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-muted-foreground"
                }`}
              >
                {v === "private" ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/dashboard" })}
            disabled={isUploading}
          >
            Cancel
          </Button>
          {!isProcessing && (
            <Button type="submit" disabled={!file || !title.trim() || isUploading}>
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
