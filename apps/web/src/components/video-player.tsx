import { useEffect, useRef } from "react";

interface VideoPlayerProps {
  manifestUrl?: string;
  thumbnailUrl?: string | null;
  autoPlay?: boolean;
  initialTime?: number;
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
}

export function VideoPlayer({
  manifestUrl,
  thumbnailUrl,
  autoPlay = false,
  initialTime,
  onTimeUpdate,
  onEnded,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<unknown>(null);

  // dash.js integration — dynamic import to avoid SSR crashes
  useEffect(() => {
    if (!videoRef.current || !manifestUrl) return;

    let cancelled = false;

    import("dashjs")
      .then(({ default: dashjs }) => {
        if (cancelled || !videoRef.current) return;

        const player = dashjs.MediaPlayer().create();
        player.initialize(videoRef.current, manifestUrl, autoPlay);

        player.updateSettings({
          streaming: {
            abr: { autoSwitchBitrate: { video: true, audio: true } },
            buffer: {
              fastSwitchEnabled: true,
              stableBufferTime: 12,
              bufferTimeAtTopQuality: 30,
            },
          },
        });

        if (initialTime && initialTime > 0) {
          player.on(dashjs.MediaPlayer.events.CAN_PLAY, () => {
            player.seek(initialTime);
          });
        }

        playerRef.current = player;
      })
      .catch(() => {
        // dashjs not installed yet — expected during early phases
      });

    return () => {
      cancelled = true;
      if (playerRef.current) {
        (playerRef.current as { destroy: () => void }).destroy();
        playerRef.current = null;
      }
    };
  }, [manifestUrl]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      {manifestUrl ? (
        <video
          ref={videoRef}
          className="h-full w-full"
          controls
          autoPlay={autoPlay}
          poster={thumbnailUrl || undefined}
          onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
          onEnded={() => onEnded?.()}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="h-16 w-16 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center">
                <div className="ml-1 h-0 w-0 border-y-8 border-l-12 border-y-transparent border-l-muted-foreground/40" />
              </div>
              <span className="text-sm">Video preview unavailable</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
