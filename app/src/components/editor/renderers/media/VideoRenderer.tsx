import React, { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertCircle, Loader, Play, Pause, Volume2, VolumeX, Maximize as EnterFullscreen, Minimize as ExitFullscreen } from "lucide-react";

interface VideoRendererProps {
  filePath: string;
  fileName: string;
}

export function VideoRenderer({ filePath }: VideoRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [videoSrc, setVideoSrc] = useState("");
  const [loading, setLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoVolume, setVideoVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
  const [videoControlsVisible, setVideoControlsVisible] = useState(true);
  const videoControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    setVideoError(null);
    setIsPlaying(false);
    setVideoTime(0);
    setVideoDuration(0);
    setVideoControlsVisible(true);
    setVideoSrc(convertFileSrc(filePath));
    setLoading(false);
    return () => {
      if (videoControlsTimerRef.current) { clearTimeout(videoControlsTimerRef.current); videoControlsTimerRef.current = null; }
      if (videoClickTimerRef.current) { clearTimeout(videoClickTimerRef.current); videoClickTimerRef.current = null; }
    };
  }, [filePath]);

  useEffect(() => {
    const onFsChange = () => setIsVideoFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const formatVideoTime = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); } else { v.pause(); setIsPlaying(false); }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const vol = parseFloat(e.target.value);
    v.volume = vol;
    setVideoVolume(vol);
    if (vol === 0) { v.muted = true; setIsMuted(true); }
    else if (v.muted) { v.muted = false; setIsMuted(false); }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = parseFloat(e.target.value);
    v.currentTime = t;
    setVideoTime(t);
  }, []);

  const toggleVideoFullscreen = useCallback(() => {
    const el = videoContainerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsVideoFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsVideoFullscreen(false)).catch(() => {});
    }
  }, []);

  const showVideoControls = useCallback(() => {
    setVideoControlsVisible(true);
    if (videoControlsTimerRef.current) clearTimeout(videoControlsTimerRef.current);
    videoControlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setVideoControlsVisible(false);
    }, 3000);
  }, []);

  const handleVideoClick = useCallback(() => {
    if (videoClickTimerRef.current) { clearTimeout(videoClickTimerRef.current); videoClickTimerRef.current = null; }
    videoClickTimerRef.current = setTimeout(() => { togglePlay(); videoClickTimerRef.current = null; }, 200);
  }, [togglePlay]);

  const handleVideoDoubleClick = useCallback(() => {
    if (videoClickTimerRef.current) { clearTimeout(videoClickTimerRef.current); videoClickTimerRef.current = null; }
    toggleVideoFullscreen();
  }, [toggleVideoFullscreen]);

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
        <div className="flex flex-col items-center gap-2">
          <Loader size={24} className="animate-spin text-primary" />
          <span className="text-xs text-white/70">Loading video...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={videoContainerRef}
      className="h-full w-full flex flex-col bg-black relative"
      onMouseMove={showVideoControls}
      onMouseLeave={() => { if (videoRef.current && !videoRef.current.paused) setVideoControlsVisible(false); }}
      onDoubleClick={handleVideoDoubleClick}
    >
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {videoSrc && !videoError && (
          <video
            ref={videoRef}
            src={videoSrc}
            className="max-h-full max-w-full object-contain"
            onClick={handleVideoClick}
            onLoadedMetadata={(e) => { const v = e.currentTarget; setVideoDuration(v.duration); setLoading(false); }}
            onTimeUpdate={(e) => setVideoTime(e.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => { setIsPlaying(false); setVideoControlsVisible(true); }}
            onError={() => { setVideoError("Failed to play video"); setLoading(false); setIsPlaying(false); }}
            playsInline
          />
        )}
        {videoError && (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <AlertCircle size={32} className="text-error" />
            <span className="text-sm text-on-surface font-medium">{videoError}</span>
            <span className="text-xs text-on-surface-variant">{filePath}</span>
          </div>
        )}
      </div>
      {!videoError && (
        <div className={`absolute bottom-0 left-0 right-0 transition-opacity duration-300 ${videoControlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pt-8 pb-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={Math.max(videoDuration || 0, 0.01)} step={0.1} value={videoTime} onChange={handleSeek} className="flex-1 h-1 appearance-none rounded-full cursor-pointer bg-white/20 accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary" />
            </div>
            <div className="flex items-center gap-3 text-white/90">
              <button onClick={togglePlay} className="p-1 rounded hover:bg-white/10 transition-colors">
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <span className="text-xs tabular-nums font-mono min-w-[80px]">{formatVideoTime(videoTime)} / {formatVideoTime(videoDuration)}</span>
              <div className="flex items-center gap-1.5 ml-1">
                <button onClick={toggleMute} className="p-1 rounded hover:bg-white/10 transition-colors">
                  {isMuted || videoVolume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input type="range" min={0} max={1} step={0.05} value={isMuted ? 0 : videoVolume} onChange={handleVolumeChange} className="w-16 h-1 appearance-none rounded-full cursor-pointer bg-white/20 accent-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white" />
              </div>
              <div className="flex-1" />
              <button onClick={toggleVideoFullscreen} className="p-1 rounded hover:bg-white/10 transition-colors">
                {isVideoFullscreen ? <ExitFullscreen size={15} /> : <EnterFullscreen size={15} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
