import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { system } from "../../../../lib/ipc";
import { Minus, Plus, RotateCw, AlertCircle, Loader } from "lucide-react";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;
const ZOOM_STEP = 0.25;

interface ImageRendererProps {
  filePath: string;
  fileName: string;
}

export function ImageRenderer({ filePath, fileName }: ImageRendererProps) {
  const [imageSrc, setImageSrc] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const imageScrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const imageMimeType = useMemo(() => {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    switch (ext) {
      case "png": return "image/png";
      case "jpg":
      case "jpeg": return "image/jpeg";
      case "gif": return "image/gif";
      case "svg": return "image/svg+xml";
      case "webp": return "image/webp";
      case "bmp": return "image/bmp";
      case "ico": return "image/x-icon";
      default: return "image/png";
    }
  }, [filePath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setImageSrc("");
    setNaturalSize({ w: 0, h: 0 });
    setZoom(1);
    system.readFileBase64(filePath).then((b64) => {
      if (cancelled) return;
      setImageSrc(`data:${imageMimeType};base64,${b64}`);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(String(err) || "Failed to load image");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filePath, imageMimeType]);

  useLayoutEffect(() => {
    const el = imageScrollRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setContainerSize({ w: Math.round(width), h: Math.round(height) });
    const ro = new ResizeObserver((entries) => {
      const { width: cw, height: ch } = entries[0].contentRect;
      setContainerSize({ w: Math.round(cw), h: Math.round(ch) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    if (!naturalSize.w || !naturalSize.h || !containerSize.w || !containerSize.h) return 1;
    return Math.min(containerSize.w / naturalSize.w, containerSize.h / naturalSize.h);
  }, [naturalSize, containerSize]);

  const displayW = naturalSize.w ? Math.round(naturalSize.w * fitScale * zoom) : undefined;
  const displayH = naturalSize.h ? Math.round(naturalSize.h * fitScale * zoom) : undefined;
  const needsScroll = displayW !== undefined && displayH !== undefined &&
    (displayW > containerSize.w || displayH > containerSize.h);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  useEffect(() => {
    const el = imageScrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) => {
          const step = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
          return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + step));
        });
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [imageSrc]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const el = imageScrollRef.current;
    if (!el) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const el = imageScrollRef.current;
    if (!el) return;
    const { x, y, scrollLeft, scrollTop } = dragStart.current;
    el.scrollLeft = scrollLeft - (e.clientX - x);
    el.scrollTop = scrollTop - (e.clientY - y);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  const resetZoom = useCallback(() => setZoom(1), []);

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low/80 backdrop-blur-sm z-20">
        <div className="flex flex-col items-center gap-2">
          <Loader size={24} className="animate-spin text-primary" />
          <span className="text-xs text-on-surface-variant">Loading image...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low/80 z-20">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertCircle size={32} className="text-error" />
          <span className="text-sm text-on-surface font-medium">Failed to load image</span>
          <span className="text-xs text-on-surface-variant">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center justify-center gap-2 border-b border-outline/10 z-10 bg-surface-container-low/60 py-2 px-4 shrink-0">
        <button onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))} className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface">
          <Minus size={14} />
        </button>
        <span className="text-xs text-on-surface-variant min-w-[48px] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))} className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface">
          <Plus size={14} />
        </button>
        <button onClick={resetZoom} className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface ml-2">
          <RotateCw size={14} />
        </button>
      </div>
      {imageSrc && (
        <div
          ref={imageScrollRef}
          className={`flex h-full w-full overflow-auto image-scroll ${needsScroll ? "items-start justify-start" : "items-center justify-center"} ${isDragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <img
            src={imageSrc}
            alt={fileName}
            onLoad={handleImageLoad}
            style={{ width: displayW, height: displayH, maxWidth: "none", objectFit: "contain", imageRendering: zoom > 2 ? "pixelated" : "auto" }}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}
