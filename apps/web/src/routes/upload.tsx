import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { Button } from "@video-site/ui/components/button";
import { Input } from "@video-site/ui/components/input";
import { Label } from "@video-site/ui/components/label";
import { ArrowLeft, Eye, EyeOff, Film, Loader2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as tus from "tus-js-client";

import { getUser } from "@/functions/get-user";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatFileSize } from "@/lib/format";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
  head: () => ({ meta: [{ title: `Upload video — ${env.VITE_APP_NAME}` }] }),
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

async function hashFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function showDuplicateOrRemovedToast(err: ApiError): void {
  const code = err.code;
  if (code === "removed_by_moderator") {
    toast.error("This video has been removed by a moderator and cannot be re-uploaded.");
    return;
  }
  if (code === "duplicate") {
    const existingId =
      typeof err.body?.existingVideoId === "string" ? err.body.existingVideoId : null;
    if (existingId) {
      toast.error("This video has already been uploaded.", {
        action: {
          label: "View video",
          onClick: () => {
            window.location.href = `/watch/${existingId}`;
          },
        },
      });
    } else {
      toast.error("This video has already been uploaded.");
    }
    return;
  }
  toast.error(err.message);
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
  const [phase, setPhase] = useState<"idle" | "hashing" | "uploading" | "processing">("idle");
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<tus.Upload | null>(null);

  const acceptDroppedFile = useCallback(
    (dropped: File | undefined) => {
      if (!dropped) return;
      const looksLikeVideo =
        dropped.type.startsWith("video/") ||
        /\.(mp4|mov|mkv|webm|avi|m4v|flv|3gp|mpg|mpeg|ts)$/i.test(dropped.name);
      if (!looksLikeVideo) {
        toast.error("That doesn't look like a video file.");
        return;
      }
      setFile(dropped);
      if (!title) setTitle(dropped.name.replace(/\.[^.]+$/, ""));
    },
    [title],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      acceptDroppedFile(e.dataTransfer.files[0]);
    },
    [acceptDroppedFile],
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
      setPhase("hashing");
      setProgress(0);

      let fileHash: string;
      try {
        fileHash = await hashFileSha256(file);
      } catch {
        toast.error("Could not read the selected file.");
        setPhase("idle");
        return;
      }

      setPhase("uploading");

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
            fileHash,
          }),
        });
        videoId = created.id;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          showDuplicateOrRemovedToast(err);
        } else {
          const msg = err instanceof ApiError ? err.message : "Failed to create video record";
          toast.error(msg);
        }
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
          const detailed = err as Error & {
            originalResponse?: { getStatus(): number; getBody(): string };
          };
          const status = detailed.originalResponse?.getStatus();
          const body = detailed.originalResponse?.getBody();
          if (status === 409 || status === 400) {
            toast.error(body || "Upload rejected.");
          } else {
            toast.error(`Upload failed: ${err.message}`);
          }
          setPhase("idle");
        });
    },
    [file, title, description, selectedTagIds, visibility, navigate, queryClient],
  );

  const isHashing = phase === "hashing";
  const isUploading = phase === "uploading";
  const isProcessing = phase === "processing";
  const isBusy = isHashing || isUploading || isProcessing;

  // Page-wide drag-and-drop. We also have to swallow drops outside the dropzone
  // so the browser doesn't navigate to the file when a stray drop misses.
  const dragDepthRef = useRef(0);
  useEffect(() => {
    if (isBusy) return;
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
      acceptDroppedFile(e.dataTransfer.files[0]);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [acceptDroppedFile, isBusy]);

  return (
    <div className="relative mx-auto w-full max-w-6xl px-4 py-8">
      {dragOver && !isBusy && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-primary bg-primary/10 px-12 py-10 text-center">
            <Upload className="mx-auto mb-3 h-12 w-12 text-primary" />
            <p className="text-lg font-medium">Drop video to upload</p>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => navigate({ to: "/dashboard" })}
        disabled={isBusy}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </button>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Upload Video</h1>
        <p className="mt-1 text-sm text-muted-foreground">Share your video with the world.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          {!file ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-video cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-12 transition-colors hover:border-muted-foreground"
            >
              <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-base font-medium">Drag & drop a video file</p>
              <p className="mt-1 text-sm text-muted-foreground">
                or click to browse — anywhere on this page works
              </p>
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

          {isHashing && (
            <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
              <p className="font-medium text-foreground">Checking file…</p>
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
        </div>

        <div className="space-y-6">
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
              rows={6}
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
            <div className="flex flex-wrap gap-2">
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

          <div className="flex justify-end gap-3 border-t border-border pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate({ to: "/dashboard" })}
              disabled={isBusy}
            >
              Cancel
            </Button>
            {!isProcessing && (
              <Button type="submit" disabled={!file || !title.trim() || isBusy}>
                {isHashing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking…
                  </>
                ) : isUploading ? (
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
        </div>
      </form>
    </div>
  );
}
