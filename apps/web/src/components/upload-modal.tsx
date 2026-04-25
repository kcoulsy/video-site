import { env } from "@video-site/env/web";
import { Button } from "@video-site/ui/components/button";
import { Input } from "@video-site/ui/components/input";
import { Label } from "@video-site/ui/components/label";
import { Eye, EyeOff, Film, Loader2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as tus from "tus-js-client";

import { ApiError, apiClient } from "@/lib/api-client";
import { formatFileSize } from "@/lib/format";

interface CreateVideoResponse {
  id: string;
  uploadUrl: string;
}

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onUploaded?: (videoId: string) => void;
}

export function UploadModal({ open, onClose, onUploaded }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<
    "public" | "unlisted" | "private"
  >("public");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<tus.Upload | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setTitle("");
    setDescription("");
    setTags("");
    setVisibility("public");
    setUploading(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    if (!open) {
      uploadRef.current?.abort();
      uploadRef.current = null;
      reset();
    }
  }, [open, reset]);

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
      setUploading(true);
      setProgress(0);

      let videoId: string;
      try {
        const created = await apiClient<CreateVideoResponse>("/api/videos", {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            visibility,
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            filename: file.name,
            mimeType: file.type || "video/mp4",
            fileSize: file.size,
          }),
        });
        videoId = created.id;
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : "Failed to create video record";
        toast.error(msg);
        setUploading(false);
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: `${env.VITE_SERVER_URL}/api/uploads`,
          retryDelays: [0, 1000, 3000, 5000],
          chunkSize: 8 * 1024 * 1024,
          metadata: {
            videoId,
            filename: file.name,
            filetype: file.type || "video/mp4",
          },
          onError: (err) => reject(err),
          onProgress: (bytesUploaded, bytesTotal) => {
            setProgress(Math.round((bytesUploaded / bytesTotal) * 100));
          },
          onSuccess: () => resolve(),
        });
        uploadRef.current = upload;
        upload.start();
      })
        .then(() => {
          toast.success("Upload complete — processing started");
          onUploaded?.(videoId);
          onClose();
        })
        .catch((err: Error) => {
          toast.error(`Upload failed: ${err.message}`);
          setUploading(false);
        });
    },
    [file, title, description, tags, visibility, onClose, onUploaded],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={uploading ? undefined : onClose}
      />

      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl animate-fade-slide-up">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Upload Video</h2>
          <button
            onClick={onClose}
            disabled={uploading}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
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
              <p className="mt-1 text-xs text-muted-foreground">
                or click to browse
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
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              {!uploading && (
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

          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Uploading...</span>
                <span className="font-medium text-primary tabular-nums">
                  {progress}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
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
              disabled={uploading}
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
              disabled={uploading}
              className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="upload-tags">Tags</Label>
            <Input
              id="upload-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="gaming, tutorial, vlog (comma separated)"
              disabled={uploading}
            />
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <div className="flex gap-2">
              {(["public", "unlisted", "private"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  disabled={uploading}
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
              onClick={onClose}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!file || !title.trim() || uploading}>
              {uploading ? (
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
          </div>
        </form>
      </div>
    </div>
  );
}
