import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { go } from "@codemirror/legacy-modes/mode/go";
import { java } from "@codemirror/legacy-modes/mode/clike";
import { cpp } from "@codemirror/legacy-modes/mode/clike";
import { lineNumbers } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Loader, Minus, Plus, RotateCcw } from "lucide-react";
import { useSessionStore } from "../../stores/useSessionStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { closeAllPopups } from "../../lib/popups";
import { EDITOR_THEMES } from "./editorThemes";
import { minimapExtension } from "./minimapExtension";

interface FileViewerProps {
  tabId: string;
  filePath: string;
  fileName: string;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);

function isImageFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

function getLanguageExtension(filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";

  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "py":
      return python();
    case "json":
      return json();
    case "rs":
      return rust();
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "scss":
    case "sass":
      return css();
    case "xml":
    case "svg":
      return xml();
    case "md":
    case "mdx":
      return markdown();
    case "sql":
      return sql();
    case "yaml":
    case "yml":
      return yaml();
    case "sh":
    case "bash":
    case "zsh":
      return StreamLanguage.define(shell);
    case "go":
      return StreamLanguage.define(go);
    case "java":
      return StreamLanguage.define(java);
    case "c":
    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return StreamLanguage.define(cpp);
    default:
      return [];
  }
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;
const ZOOM_STEP = 0.25;

export function FileViewer({ tabId, filePath, fileName }: FileViewerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialContentRef = useRef<string>("");
  const updateTab = useSessionStore((s) => s.updateTab);
  const editorTheme = useSettingsStore((s) => s.editorTheme);

  const isImage = isImageFile(filePath);

  const [imageSrc, setImageSrc] = useState("");
  const [zoom, setZoom] = useState(1);

  const resetZoom = useCallback(() => setZoom(1), []);

  const imageScrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

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

  // Non-passive wheel listener so Ctrl+Scroll zoom can prevent browser zoom
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
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const el = imageScrollRef.current;
    if (!el) return;
    const { x, y, scrollLeft, scrollTop } = dragStart.current;
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    el.scrollLeft = scrollLeft - dx;
    el.scrollTop = scrollTop - dy;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

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
    const loadFile = async () => {
      try {
        setLoading(true);
        setError(null);

        if (isImage) {
          const b64 = await invoke<string>("read_file_base64", { path: filePath });
          setImageSrc(`data:${imageMimeType};base64,${b64}`);
          setLoading(false);
          return;
        }

        if (!editorRef.current) return;

        const content = await invoke<string>("read_file_content", {
          path: filePath,
        });
        initialContentRef.current = content;

        const languageExt = getLanguageExtension(filePath);

        const extensions: any[] = [
          basicSetup,
          EDITOR_THEMES[editorTheme],
          lineNumbers(),
          minimapExtension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const currentContent = update.state.doc.toString();
              const isDirty = currentContent !== initialContentRef.current;
              updateTab(tabId, { dirty: isDirty, fileContent: currentContent });
            }
          }),
        ];

        if (languageExt) {
          extensions.push(languageExt);
        }

        const state = EditorState.create({
          doc: content,
          extensions,
        });

        const view = new EditorView({
          state,
          parent: editorRef.current,
        });

        viewRef.current = view;
        setLoading(false);
      } catch (err) {
        console.error("Failed to load file:", err);
        setError(String(err) || "Failed to load file");
        setLoading(false);
      }
    };

    loadFile();

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      updateTab(tabId, { dirty: false });
    };
  }, [filePath, tabId, updateTab, isImage, imageMimeType, editorTheme]);

  useEffect(() => {
    const handler = () => {
      if (viewRef.current) {
        viewRef.current.dispatch({ selection: { anchor: 0, head: viewRef.current.state.doc.length } });
      }
    };
    window.addEventListener("file-select-all", handler);
    return () => window.removeEventListener("file-select-all", handler);
  }, []);

  // Store initial content ref so save functions can reset dirty after write
  // (fileContent is stored in the session store via updateListener above)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let selectedText = "";
    if (viewRef.current) {
      const sel = viewRef.current.state.selection.main;
      if (!sel.empty) {
        selectedText = viewRef.current.state.sliceDoc(sel.from, sel.to);
      }
    }

    closeAllPopups();
    window.dispatchEvent(
      new CustomEvent("show-context-menu", {
        detail: { x: e.clientX, y: e.clientY, selectedText, source: "file", filePath },
      })
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-surface-container-low">
      <div className="flex-1 overflow-hidden w-full relative" onContextMenu={isImage ? undefined : handleContextMenu}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low/80 backdrop-blur-sm z-20">
            <div className="flex flex-col items-center gap-2">
              <Loader size={24} className="animate-spin text-primary" />
              <span className="text-xs text-on-surface-variant">Loading file...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low/80 z-20">
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <AlertCircle size={32} className="text-error" />
              <span className="text-sm text-on-surface font-medium">Failed to load file</span>
              <span className="text-xs text-on-surface-variant">{error}</span>
            </div>
          </div>
        )}

        {isImage ? (
          <div className="h-full w-full flex flex-col">
            <div className="flex items-center justify-center gap-2 border-b border-outline/10 z-10 bg-surface-container-low/60 py-2 px-4 shrink-0">
              <button
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface"
              >
                <Minus size={14} />
              </button>
              <span className="text-xs text-on-surface-variant min-w-[48px] text-center tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={resetZoom}
                className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface ml-2"
              >
                <RotateCcw size={14} />
              </button>
            </div>
            {imageSrc && (
              <div
                ref={imageScrollRef}
                className={`flex h-full w-full overflow-auto image-scroll ${needsScroll ? "items-start justify-start" : "items-center justify-center"}
                   ${isDragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                {imageSrc && (
                  <img
                    src={imageSrc}
                    alt={fileName}
                    onLoad={handleImageLoad}
                    style={{
                      width: displayW,
                      height: displayH,
                      maxWidth: "none",
                      objectFit: "contain",
                      imageRendering: zoom > 2 ? "pixelated" : "auto",
                    }}
                    draggable={false}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            ref={editorRef}
            className="h-full w-full overflow-hidden [&_.cm-editor]:h-full"
          />
        )}
      </div>
    </div>
  );
}
