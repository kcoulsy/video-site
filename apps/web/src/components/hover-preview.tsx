import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { env } from "@video-site/env/web";

interface DashPlayer {
  initialize: (el: HTMLVideoElement, url: string, autoPlay: boolean) => void;
  updateSettings: (settings: unknown) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  seek: (t: number) => void;
  destroy: () => void;
}

interface HoverPreviewProps {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
}

const HOVER_DELAY_MS = 600;

let activeStop: (() => void) | null = null;

export function HoverPreview({ videoId, title, thumbnailUrl, duration }: HoverPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<DashPlayer | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);

  const stop = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    cancelledRef.current = true;
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {
        // ignore
      }
      playerRef.current = null;
    }
    if (activeStop === stop) activeStop = null;
    setActive(false);
    setPlaying(false);
  };

  const start = () => {
    if (typeof window === "undefined") return;
    if (!thumbnailUrl) return;
    if (window.matchMedia("(hover: none)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    if (timerRef.current !== null) return;

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (activeStop && activeStop !== stop) activeStop();
      activeStop = stop;
      cancelledRef.current = false;
      setActive(true);
    }, HOVER_DELAY_MS);
  };

  // Boot dash.js when active flips on
  useEffect(() => {
    if (!active) return;
    if (!videoRef.current) return;

    let localCancelled = false;
    let seeked = false;

    const manifestUrl = `${env.VITE_SERVER_URL}/api/stream/${videoId}/manifest.mpd`;

    import("dashjs")
      .then((dashjs) => {
        if (localCancelled || cancelledRef.current || !videoRef.current) return;

        const player = dashjs.MediaPlayer().create() as unknown as DashPlayer;
        player.initialize(videoRef.current, manifestUrl, true);
        player.updateSettings({
          streaming: {
            abr: { autoSwitchBitrate: { video: true, audio: true } },
            buffer: {
              fastSwitchEnabled: true,
              bufferTimeDefault: 6,
              bufferTimeAtTopQuality: 12,
            },
          },
        });

        player.on(dashjs.MediaPlayer.events.CAN_PLAY, () => {
          if (seeked) return;
          seeked = true;
          if (duration && duration >= 30) {
            const offset = duration * (0.2 + Math.random() * 0.4);
            try {
              player.seek(offset);
            } catch {
              // ignore
            }
          }
        });

        playerRef.current = player;
      })
      .catch(() => {
        // dashjs unavailable
      });

    return () => {
      localCancelled = true;
    };
  }, [active, videoId, duration]);

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="absolute inset-0"
      onMouseEnter={start}
      onMouseLeave={stop}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
          <Play className="h-10 w-10 text-muted-foreground/30" />
        </div>
      )}

      {active && (
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          onPlaying={() => setPlaying(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            playing ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}
