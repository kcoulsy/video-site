import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@video-site/ui/components/button";
import { Checkbox } from "@video-site/ui/components/checkbox";
import { env } from "@video-site/env/web";

interface Props {
  open: boolean;
  onClose: () => void;
  videoId?: string;
  playlistId?: string;
  title: string;
  currentTime?: number;
}

function buildShareLinks(url: string, title: string) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return [
    { label: "X", href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { label: "Reddit", href: `https://www.reddit.com/submit?url=${u}&title=${t}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
  ];
}

export function ShareDialog({ open, onClose, videoId, playlistId, title, currentTime }: Props) {
  const [includeTimestamp, setIncludeTimestamp] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setIncludeTimestamp(false);
      setCopiedKey(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const base = videoId
    ? `${env.VITE_WEB_URL}/watch/${videoId}`
    : playlistId
      ? `${env.VITE_WEB_URL}/playlist/${playlistId}`
      : env.VITE_WEB_URL;

  const ts = currentTime ? Math.floor(currentTime) : 0;
  const link = includeTimestamp && videoId && ts > 0 ? `${base}?t=${ts}` : base;

  const embedUrl = videoId
    ? `${env.VITE_WEB_URL}/embed/${videoId}${includeTimestamp && ts > 0 ? `?t=${ts}` : ""}`
    : null;
  const embedCode = embedUrl
    ? `<iframe src="${embedUrl}" width="640" height="360" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`
    : null;

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Share</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {videoId && currentTime != null && currentTime > 0 && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeTimestamp}
              onCheckedChange={(v) => setIncludeTimestamp(!!v)}
            />
            <span>
              Start at{" "}
              <span className="font-mono">
                {Math.floor(ts / 60)}:{String(ts % 60).padStart(2, "0")}
              </span>
            </span>
          </label>
        )}

        <div className="mt-4">
          <label className="text-xs font-medium text-muted-foreground">Link</label>
          <div className="mt-1 flex gap-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
            />
            <Button size="sm" variant="secondary" onClick={() => copy("link", link)}>
              {copiedKey === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {embedCode && (
          <div className="mt-4">
            <label className="text-xs font-medium text-muted-foreground">Embed</label>
            <div className="mt-1 flex gap-2">
              <textarea
                readOnly
                value={embedCode}
                onFocus={(e) => e.currentTarget.select()}
                rows={2}
                className="flex-1 resize-none rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-[10px] outline-none"
              />
              <Button size="sm" variant="secondary" onClick={() => copy("embed", embedCode)}>
                {copiedKey === "embed" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground">Share to</p>
          <div className="mt-2 flex gap-2">
            {buildShareLinks(link, title).map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 rounded-full border border-border px-3 py-1.5 text-center text-xs font-medium transition-colors hover:bg-accent"
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
