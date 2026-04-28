import { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatDuration } from "../lib/format";

interface StoryboardMeta {
  url: string;
  interval: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

interface VideoPlayerProps {
  manifestUrl?: string;
  thumbnailUrl?: string | null;
  storyboard?: StoryboardMeta | null;
  autoPlay?: boolean;
  initialTime?: number;
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
  cinemaMode?: boolean;
  onToggleCinema?: () => void;
}

interface QualityOption {
  id: string;
  index: number;
  height: number;
  bitrate: number;
}

interface DashRepresentation {
  id: string;
  index: number;
  height: number;
  bandwidth: number;
}

interface DashPlayer {
  initialize: (el: HTMLVideoElement, url: string, autoPlay: boolean) => void;
  updateSettings: (settings: unknown) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  seek: (t: number) => void;
  destroy: () => void;
  getRepresentationsByType: (type: string) => DashRepresentation[];
  setRepresentationForTypeById: (type: string, id: string, forceReplace?: boolean) => void;
  setRepresentationForTypeByIndex: (type: string, index: number, forceReplace?: boolean) => void;
}

export function VideoPlayer({
  manifestUrl,
  thumbnailUrl,
  storyboard,
  autoPlay = false,
  initialTime,
  onTimeUpdate,
  onEnded,
  cinemaMode,
  onToggleCinema,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<DashPlayer | null>(null);
  const initialTimeRef = useRef<number | undefined>(initialTime);
  const hideTimerRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [currentQuality, setCurrentQuality] = useState<string | null>(null); // null = auto
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  useEffect(() => {
    initialTimeRef.current = initialTime;
  }, [initialTime]);

  // dash.js setup
  useEffect(() => {
    if (!videoRef.current || !manifestUrl) return;

    let cancelled = false;
    let seeked = false;

    import("dashjs")
      .then((dashjs) => {
        if (cancelled || !videoRef.current) return;

        const player = dashjs.MediaPlayer().create() as unknown as DashPlayer;
        player.initialize(videoRef.current, manifestUrl, autoPlay);

        player.updateSettings({
          streaming: {
            abr: { autoSwitchBitrate: { video: true, audio: true } },
            buffer: {
              fastSwitchEnabled: true,
              bufferTimeDefault: 12,
              bufferTimeAtTopQuality: 30,
            },
          },
        });

        player.on(dashjs.MediaPlayer.events.CAN_PLAY, () => {
          if (seeked) return;
          const t = initialTimeRef.current;
          if (t && t > 0) player.seek(t);
          seeked = true;
        });

        const refreshQualities = () => {
          const list = player.getRepresentationsByType("video") || [];
          setQualities(
            list.map((r) => ({
              id: r.id,
              index: r.index,
              height: r.height,
              bitrate: r.bandwidth,
            })),
          );
        };
        player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, refreshQualities);

        playerRef.current = player;
      })
      .catch(() => {
        // dashjs not installed yet
      });

    return () => {
      cancelled = true;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [manifestUrl, autoPlay]);

  // Native video event wiring
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setCurrentTime(v.currentTime);
      onTimeUpdate?.(v.currentTime);
    };
    const onDur = () => setDuration(v.duration || 0);
    const onProg = () => {
      if (v.buffered.length > 0) {
        setBuffered(v.buffered.end(v.buffered.length - 1));
      }
    };
    const onVol = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onWait = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onEndedEvt = () => onEnded?.();
    const onEnterPip = () => setPipActive(true);
    const onLeavePip = () => setPipActive(false);

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("progress", onProg);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("waiting", onWait);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("canplay", onPlaying);
    v.addEventListener("ended", onEndedEvt);
    v.addEventListener("enterpictureinpicture", onEnterPip);
    v.addEventListener("leavepictureinpicture", onLeavePip);

    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("progress", onProg);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("waiting", onWait);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("canplay", onPlaying);
      v.removeEventListener("ended", onEndedEvt);
      v.removeEventListener("enterpictureinpicture", onEnterPip);
      v.removeEventListener("leavepictureinpicture", onLeavePip);
    };
  }, [onTimeUpdate, onEnded]);

  // Fullscreen state
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.5;
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  }, []);

  const seekToPercent = useCallback((pct: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.duration * pct));
  }, []);

  const adjustVolume = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(1, v.volume + delta));
    v.volume = next;
    if (next > 0) v.muted = false;
  }, []);

  const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const stepPlaybackRate = useCallback((dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    const idx = PLAYBACK_RATES.indexOf(v.playbackRate);
    const cur = idx === -1 ? PLAYBACK_RATES.indexOf(1) : idx;
    const next = Math.max(0, Math.min(PLAYBACK_RATES.length - 1, cur + dir));
    v.playbackRate = PLAYBACK_RATES[next]!;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  const togglePip = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      // ignored
    }
  }, []);

  const setQuality = useCallback((option: QualityOption | null) => {
    const player = playerRef.current;
    if (!player) return;
    if (option === null) {
      player.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: true } } },
      });
      setCurrentQuality(null);
    } else {
      player.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: false } } },
      });
      try {
        player.setRepresentationForTypeById("video", option.id, true);
      } catch {
        player.setRepresentationForTypeByIndex("video", option.index, true);
      }
      setCurrentQuality(option.id);
    }
    setSettingsOpen(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!containerRef.current) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Only when player or its descendant is focused, OR fullscreen
      const focused =
        containerRef.current.contains(document.activeElement) ||
        document.fullscreenElement === containerRef.current;
      if (!focused) return;

      const key = e.key.toLowerCase();

      if (key >= "0" && key <= "9" && !e.shiftKey) {
        e.preventDefault();
        seekToPercent(Number(key) / 10);
        return;
      }

      switch (key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "j":
          e.preventDefault();
          seekBy(-10);
          break;
        case "l":
          e.preventDefault();
          seekBy(10);
          break;
        case "arrowleft":
          e.preventDefault();
          seekBy(-5);
          break;
        case "arrowright":
          e.preventDefault();
          seekBy(5);
          break;
        case "arrowup":
          e.preventDefault();
          adjustVolume(0.1);
          break;
        case "arrowdown":
          e.preventDefault();
          adjustVolume(-0.1);
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case ",":
          if (e.shiftKey) {
            e.preventDefault();
            stepPlaybackRate(-1);
          }
          break;
        case ".":
          if (e.shiftKey) {
            e.preventDefault();
            stepPlaybackRate(1);
          }
          break;
        case "t":
          if (onToggleCinema) {
            e.preventDefault();
            onToggleCinema();
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    togglePlay,
    seekBy,
    seekToPercent,
    adjustVolume,
    stepPlaybackRate,
    toggleFullscreen,
    toggleMute,
    onToggleCinema,
  ]);

  // Auto-hide controls
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!videoRef.current?.paused && !settingsOpen) setControlsVisible(false);
    }, 2500);
  }, [settingsOpen]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Scrubber interactions
  const scrubberRef = useRef<HTMLDivElement>(null);

  const timeFromEvent = (clientX: number): number => {
    const el = scrubberRef.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const onScrubMove = (e: MouseEvent) => {
    const t = timeFromEvent(e.clientX);
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
  };
  const onScrubUp = () => {
    window.removeEventListener("mousemove", onScrubMove);
    window.removeEventListener("mouseup", onScrubUp);
  };

  const beginScrub = (e: React.MouseEvent) => {
    const t = timeFromEvent(e.clientX);
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
    window.addEventListener("mousemove", onScrubMove);
    window.addEventListener("mouseup", onScrubUp);
  };

  if (!manifestUrl) {
    return (
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <div className="flex h-full w-full items-center justify-center">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="h-16 w-16 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center">
                <div className="ml-1 h-0 w-0 border-y-8 border-l-12 border-y-transparent border-l-muted-foreground/40" />
              </div>
              <span className="text-sm">Video preview unavailable</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const progressPct = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`group relative w-full overflow-hidden bg-black focus:outline-none ${
        fullscreen ? "h-screen" : "aspect-video"
      } ${controlsVisible || !playing ? "cursor-default" : "cursor-none"}`}
      onMouseMove={showControls}
      onMouseLeave={() => {
        if (playing && !settingsOpen) setControlsVisible(false);
      }}
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        autoPlay={autoPlay}
        poster={thumbnailUrl || undefined}
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {/* Loading spinner */}
      {waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}

      {/* Big center play button when paused */}
      {!playing && !waiting && (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity"
          aria-label="Play"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-black/60">
            <Play className="ml-1 h-10 w-10 fill-white text-white" />
          </div>
        </button>
      )}

      {/* Controls overlay */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pb-2 pt-12 transition-opacity duration-200 ${
          controlsVisible || !playing || settingsOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Scrubber */}
        <div
          ref={scrubberRef}
          className="pointer-events-auto group/scrub relative mx-3 h-4 cursor-pointer"
          onMouseDown={beginScrub}
          onMouseMove={(e) => setHoverTime(timeFromEvent(e.clientX))}
          onMouseLeave={() => setHoverTime(null)}
        >
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-white/25 transition-[height] group-hover/scrub:h-1.5">
            <div
              className="absolute inset-y-0 left-0 rounded bg-white/40"
              style={{ width: `${bufferedPct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded bg-red-600"
              style={{ width: `${progressPct}%` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-red-600 opacity-0 transition-opacity group-hover/scrub:opacity-100"
              style={{ left: `${progressPct}%` }}
            />
          </div>
          {hoverTime !== null && duration > 0 && (
            <div
              className="pointer-events-none absolute bottom-5 -translate-x-1/2"
              style={{ left: `${(hoverTime / duration) * 100}%` }}
            >
              {storyboard &&
                (() => {
                  const tileCount = storyboard.cols * storyboard.rows;
                  const idx = Math.min(
                    tileCount - 1,
                    Math.max(0, Math.floor(hoverTime / storyboard.interval)),
                  );
                  const col = idx % storyboard.cols;
                  const row = Math.floor(idx / storyboard.cols);
                  return (
                    <div
                      className="mb-1 overflow-hidden rounded border border-white/20 bg-black shadow-lg"
                      style={{
                        width: storyboard.tileWidth,
                        height: storyboard.tileHeight,
                        backgroundImage: `url(${storyboard.url})`,
                        backgroundPosition: `-${col * storyboard.tileWidth}px -${row * storyboard.tileHeight}px`,
                        backgroundSize: `${storyboard.cols * storyboard.tileWidth}px ${storyboard.rows * storyboard.tileHeight}px`,
                        backgroundRepeat: "no-repeat",
                      }}
                    />
                  );
                })()}
              <div className="mx-auto inline-block rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
                {formatDuration(hoverTime)}
              </div>
            </div>
          )}
        </div>

        {/* Bottom row */}
        <div className="pointer-events-auto flex items-center gap-2 px-3 pt-1 text-white">
          <button
            type="button"
            onClick={togglePlay}
            className="rounded p-1.5 hover:bg-white/10"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </button>

          <div className="group/vol flex items-center">
            <button
              type="button"
              onClick={toggleMute}
              className="rounded p-1.5 hover:bg-white/10"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = videoRef.current;
                if (!v) return;
                v.volume = Number(e.target.value);
                v.muted = v.volume === 0;
              }}
              className="ml-1 h-1 w-0 cursor-pointer appearance-none rounded bg-white/40 accent-white opacity-0 transition-all duration-150 group-hover/vol:w-20 group-hover/vol:opacity-100 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          <div className="ml-1 select-none text-xs tabular-nums">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </div>

          <div className="ml-auto flex items-center gap-1">
            {qualities.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSettingsOpen((s) => !s)}
                  className="rounded px-2 py-1 text-xs font-medium tabular-nums hover:bg-white/10"
                  aria-label="Quality"
                  aria-haspopup="menu"
                  aria-expanded={settingsOpen}
                >
                  {currentQuality === null
                    ? "Auto"
                    : `${qualities.find((q) => q.id === currentQuality)?.height ?? ""}p`}
                </button>
                {settingsOpen && (
                  <div
                    role="menu"
                    className="absolute bottom-full right-0 mb-2 min-w-[140px] rounded-md bg-black/90 py-1 text-sm shadow-lg"
                  >
                    <div className="px-3 py-1 text-xs uppercase tracking-wide text-white/50">
                      Quality
                    </div>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={currentQuality === null}
                      onClick={() => setQuality(null)}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-white/10 ${
                        currentQuality === null ? "text-white" : "text-white/80"
                      }`}
                    >
                      Auto
                      {currentQuality === null && <span>•</span>}
                    </button>
                    {[...qualities]
                      .sort((a, b) => b.height - a.height)
                      .map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={currentQuality === q.id}
                          onClick={() => setQuality(q)}
                          className={`flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-white/10 ${
                            currentQuality === q.id ? "text-white" : "text-white/80"
                          }`}
                        >
                          {q.height}p{currentQuality === q.id && <span>•</span>}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {onToggleCinema && (
              <button
                type="button"
                onClick={onToggleCinema}
                className="rounded p-1.5 hover:bg-white/10"
                aria-label={cinemaMode ? "Exit cinema mode" : "Cinema mode"}
                aria-pressed={cinemaMode}
              >
                <RectangleHorizontal className={`h-5 w-5 ${cinemaMode ? "fill-white" : ""}`} />
              </button>
            )}

            {typeof document !== "undefined" && "pictureInPictureEnabled" in document && (
              <button
                type="button"
                onClick={togglePip}
                className="rounded p-1.5 hover:bg-white/10"
                aria-label="Picture in picture"
              >
                <PictureInPicture2 className={`h-5 w-5 ${pipActive ? "text-red-500" : ""}`} />
              </button>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded p-1.5 hover:bg-white/10"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
