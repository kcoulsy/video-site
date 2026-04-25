import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, History, Play } from "lucide-react";

import {
  formatDuration,
  formatRelativeTime,
} from "@/lib/format";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

interface WatchedVideo {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number;
  watchedSeconds: number;
  progressPercent: number;
  lastWatchedAt: string;
  user: { name: string };
}

// Mock data — replace with GET /api/history
const MOCK_CONTINUE: WatchedVideo[] = [
  {
    id: "v1",
    title: "Building a Full-Stack App with TanStack Start",
    thumbnailUrl: null,
    duration: 2100,
    watchedSeconds: 840,
    progressPercent: 0.4,
    lastWatchedAt: new Date(Date.now() - 3600000).toISOString(),
    user: { name: "Alex Turner" },
  },
  {
    id: "v2",
    title: "Advanced TypeScript Patterns You Need to Know",
    thumbnailUrl: null,
    duration: 1256,
    watchedSeconds: 628,
    progressPercent: 0.5,
    lastWatchedAt: new Date(Date.now() - 7200000).toISOString(),
    user: { name: "Sarah Chen" },
  },
  {
    id: "v3",
    title: "The Future of Web Streaming Technology",
    thumbnailUrl: null,
    duration: 892,
    watchedSeconds: 200,
    progressPercent: 0.22,
    lastWatchedAt: new Date(Date.now() - 86400000).toISOString(),
    user: { name: "Mike Rodriguez" },
  },
];

const MOCK_HISTORY: WatchedVideo[] = [
  ...MOCK_CONTINUE,
  {
    id: "v4",
    title: "Cinema-Quality Color Grading Tutorial",
    thumbnailUrl: null,
    duration: 1800,
    watchedSeconds: 1800,
    progressPercent: 1.0,
    lastWatchedAt: new Date(Date.now() - 172800000).toISOString(),
    user: { name: "Emma Wilson" },
  },
  {
    id: "v5",
    title: "Understanding DASH Streaming Protocol",
    thumbnailUrl: null,
    duration: 720,
    watchedSeconds: 720,
    progressPercent: 1.0,
    lastWatchedAt: new Date(Date.now() - 604800000).toISOString(),
    user: { name: "Alex Turner" },
  },
];

function HistoryPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-8 flex items-center gap-3">
        <History className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Watch History</h1>
      </div>

      {/* Continue Watching */}
      {MOCK_CONTINUE.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            <Play className="h-4 w-4" />
            Continue Watching
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {MOCK_CONTINUE.map((video, i) => (
              <div
                key={video.id}
                className="animate-fade-slide-up"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <ContinueCard video={video} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Full History */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          <Clock className="h-4 w-4" />
          All History
        </h2>
        <div className="space-y-2">
          {MOCK_HISTORY.map((video, i) => (
            <div
              key={`${video.id}-history`}
              className="animate-fade-slide-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <HistoryRow video={video} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ContinueCard({ video }: { video: WatchedVideo }) {
  return (
    <Link
      to="/watch/$videoId"
      params={{ videoId: video.id }}
      className="group block"
    >
      <div className="relative aspect-video overflow-hidden rounded-xl bg-secondary">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <Play className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}

        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${video.progressPercent * 100}%` }}
          />
        </div>

        {/* Resume hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 backdrop-blur-sm">
            <Play className="h-4 w-4 fill-white text-white" />
            <span className="text-sm font-medium text-white">Resume</span>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <h3 className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">
          {video.title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDuration(video.watchedSeconds)} /{" "}
          {formatDuration(video.duration)} &middot; {video.user.name}
        </p>
      </div>
    </Link>
  );
}

function HistoryRow({ video }: { video: WatchedVideo }) {
  const isComplete = video.progressPercent >= 0.9;

  return (
    <Link
      to="/watch/$videoId"
      params={{ videoId: video.id }}
      className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-secondary/50"
    >
      <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <Play className="h-6 w-6 text-muted-foreground/30" />
          </div>
        )}
        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
          {formatDuration(video.duration)}
        </span>
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20">
          <div
            className="h-full bg-primary"
            style={{
              width: `${Math.min(video.progressPercent, 1) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">
          {video.title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {video.user.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {isComplete
            ? "Watched"
            : `${Math.round(video.progressPercent * 100)}% watched`}{" "}
          &middot; {formatRelativeTime(video.lastWatchedAt)}
        </p>
      </div>
    </Link>
  );
}
