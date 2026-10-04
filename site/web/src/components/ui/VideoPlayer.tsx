import { useEffect, useRef, useState } from "react";
import { Loader2, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";

interface VideoPlayerProps {
  src: string;
  className?: string;
  frameless?: boolean;
  // Intrinsic size, used to reserve layout space so attaching the source late
  // does not shift the page.
  width: number;
  height: number;
}

function formatTime(t: number): string {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoPlayer({
  src,
  className,
  frameless = false,
  width,
  height,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The source stays detached until the visitor asks for playback, so the
  // browser never preloads a video nobody is watching.
  const [isAttached, setIsAttached] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Set by the hover or click that armed the source, replayed once it can play.
  const playOnAttachRef = useRef(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrent(v.currentTime);
    const onMeta = () => setDuration(v.duration);
    const onPlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => {
      setIsBuffering(false);
      if (!playOnAttachRef.current) return;
      playOnAttachRef.current = false;
      void v.play();
    };
    const onError = () => setIsBuffering(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("error", onError);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("error", onError);
    };
  }, [isAttached]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const attach = () => {
    if (!isAttached) setIsAttached(true);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!isAttached) {
      playOnAttachRef.current = true;
      attach();
      setIsBuffering(true);
      return;
    }
    if (v.paused) void v.play();
    else v.pause();
  };

  // Attach on hover so the metadata is ready, but do not treat the hover as
  // intent to play: `preload="none"` means nothing is fetched until play().
  const prefetch = () => attach();

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    v.currentTime = ratio * duration;
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) void el.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  const pct = duration ? (current / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onPointerEnter={prefetch}
      className={`group relative overflow-hidden ${frameless ? "" : "rounded-2xl border border-outline bg-surface"} ${className ?? ""}`}
    >
      <video
        ref={videoRef}
        src={isAttached ? src : undefined}
        width={width}
        height={height}
        preload="none"
        onClick={togglePlay}
        playsInline
        className="h-auto w-full"
      />

      {!isPlaying && (
        <button
          onClick={togglePlay}
          aria-label={isBuffering ? "Loading video" : "Play video"}
          className="absolute inset-0 flex items-center justify-center bg-background/30 transition-colors hover:bg-background/40"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-on-primary shadow-[0_0_40px_rgba(79,140,255,0.5)] transition-transform hover:scale-105">
            {isBuffering ? (
              <Loader2 size={28} className="animate-spin" />
            ) : (
              <Play size={28} className="ml-1" fill="currentColor" />
            )}
          </span>
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 py-3 text-white opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" />
          )}
        </button>
        <span className="text-[12px] tabular-nums">{formatTime(current)}</span>
        <div
          onClick={onSeek}
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/20"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[12px] tabular-nums">{formatTime(duration)}</span>
        <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button onClick={toggleFullscreen} aria-label="Toggle fullscreen">
          {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </div>
    </div>
  );
}