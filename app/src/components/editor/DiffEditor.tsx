import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { MergeView } from "@codemirror/merge";
import { EditorView as EditorViewClass } from "@codemirror/view";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { EDITOR_THEMES, READONLY_EDITOR_THEME } from "./editorThemes";
import { createMinimapExtension } from "./minimapExtension";
import { getLanguageExtension } from "../../lib/codeLang";
import { PathBreadcrumb } from "./PathBreadcrumb";

// ─── global styles injected once ─────────────────────────────────────────────
const STYLE_ID = "aurora-diff-style";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    /* The wrapper we control is a flex row — MergeView fills it */
    .aurora-diff-inner             { display: flex; flex-direction: row; width: 100%; height: 100%; overflow: hidden; }

    /* MergeView root — fill the wrapper */
    .aurora-diff-inner .cm-mergeView      { flex: 1; display: flex; flex-direction: row; height: 100%; min-width: 0; overflow: hidden; }
    .aurora-diff-inner .cm-merge-2pane    { flex: 1; display: flex; flex-direction: row; height: 100%; min-width: 0; overflow: hidden; }

    /* Each pane: fixed width set imperatively after mount, flex disabled */
    .aurora-diff-inner .cm-merge-pane          { display: flex; flex-direction: column; height: 100%; overflow: hidden; min-width: 0; }
    .aurora-diff-inner .cm-merge-pane .cm-editor    { flex: 1; min-height: 0; height: 100%; }
    .aurora-diff-inner .cm-merge-pane .cm-scroller  { overflow: auto !important; }

    /* Gap strip between panes */
    .aurora-diff-inner .cm-merge-gap      { flex-shrink: 0 !important; width: 2px !important; background: rgba(232,234,240,0.07) !important; border: none !important; }
    .aurora-diff-inner .cm-merge-gutter   { background: transparent !important; }

    /* Diff colours */
    .aurora-diff-inner .cm-deletedChunk                  { background: rgba(255,70,70,0.09) !important; }
    .aurora-diff-inner .cm-deletedChunk .cm-deletedText  { background: rgba(255,70,70,0.28) !important; text-decoration: none !important; }
    .aurora-diff-inner .cm-changedLine                   { background: rgba(255,179,0,0.06) !important; }
    .aurora-diff-inner .cm-changedText                   { background: rgba(255,179,0,0.22) !important; border-radius: 2px; }
    .aurora-diff-inner .cm-insertedLine                  { background: rgba(80,227,194,0.07) !important; }

    /* Gutters */
    .aurora-diff-inner .cm-gutters          { background: transparent !important; border-right: 1px solid rgba(232,234,240,0.06) !important; }
    .aurora-diff-inner .cm-activeLineGutter { background: transparent !important; }
    .aurora-diff-inner .cm-activeLine       { background: rgba(255,255,255,0.022) !important; }

    /* Minimap */
    .aurora-diff-inner .cm-minimap         { border-left: 1px solid rgba(232,234,240,0.05) !important; opacity: 0.72; }
    .aurora-diff-inner .cm-minimap-overlay { background: rgba(232,234,240,0.07) !important; border: 1px solid rgba(232,234,240,0.13) !important; }

    /* Resizer handle */
    .aurora-diff-resizer {
      position: absolute; top: 0; bottom: 0; width: 6px;
      transform: translateX(-50%);
      cursor: col-resize; z-index: 20;
      background: transparent;
      transition: background 0.15s;
    }
    .aurora-diff-resizer:hover,
    .aurora-diff-resizer.dragging { background: rgba(79,140,255,0.35); }
  `;
  document.head.appendChild(s);
}

// ─── scroll sync ──────────────────────────────────────────────────────────────
function attachScrollSync(self: EditorView, getOther: () => EditorView | null): () => void {
  let locked = false;
  const handler = () => {
    if (locked) return;
    const other = getOther();
    if (!other) return;
    const s = self.scrollDOM, o = other.scrollDOM;
    const maxY = s.scrollHeight - s.clientHeight;
    const maxX = s.scrollWidth - s.clientWidth;
    locked = true;
    if (maxY > 0) o.scrollTop = (s.scrollTop / maxY) * Math.max(0, o.scrollHeight - o.clientHeight);
    if (maxX > 0) o.scrollLeft = (s.scrollLeft / maxX) * Math.max(0, o.scrollWidth - o.clientWidth);
    requestAnimationFrame(() => { locked = false; });
  };
  self.scrollDOM.addEventListener("scroll", handler, { passive: true });
  return () => self.scrollDOM.removeEventListener("scroll", handler);
}

// ─── DiffEditor ───────────────────────────────────────────────────────────────
export function DiffEditor({
  filePath, oldContent, newContent,
  oldLabel = "before", newLabel = "after",
  commitHash, onOpenFile,
}: {
  filePath: string; oldContent: string; newContent: string;
  oldLabel?: string; newLabel?: string;
  commitHash?: string; onOpenFile?: (path: string) => void;
}) {
  // The outer shell (breadcrumb + pane-headers + editor area)
  const shellRef = useRef<HTMLDivElement>(null);
  // The div MergeView mounts into
  const mountRef = useRef<HTMLDivElement>(null);
  // The absolutely-positioned resizer pill
  const resizerRef = useRef<HTMLDivElement>(null);

  // Track resizer left position in state so React re-renders it when dragging
  const [resizerLeft, setResizerLeft] = useState<number | null>(null);

  const mergeRef = useRef<MergeView | null>(null);
  const viewARef = useRef<EditorView | null>(null);
  const viewBRef = useRef<EditorView | null>(null);
  const cleanupsRef = useRef<(() => void)[]>([]);

  const editorTheme = useSettingsStore((s) => s.editorTheme);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- destroy previous ---
    cleanupsRef.current.forEach((f) => f());
    cleanupsRef.current = [];
    mergeRef.current?.destroy();

    const langExt = getLanguageExtension(filePath);

    const base = [
      basicSetup,
      EDITOR_THEMES[editorTheme],
      createMinimapExtension(true),
      EditorViewClass.editable.of(false),
      EditorState.readOnly.of(true),
      READONLY_EDITOR_THEME,
      ...(langExt ? [langExt] : []),
    ];

    const merge = new MergeView({
      a: { doc: oldContent, extensions: base },
      b: { doc: newContent, extensions: base },
      parent: mount,
      orientation: "a-b",
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
    });

    mergeRef.current = merge;
    viewARef.current = merge.a;
    viewBRef.current = merge.b;

    // --- set explicit 50/50 widths on the actual pane elements ---
    const panes = mount.querySelectorAll<HTMLElement>(".cm-merge-pane");
    const paneA = panes[0];
    const paneB = panes[1];

    const applyWidths = (leftPx: number) => {
      const totalW = mount.getBoundingClientRect().width;
      const GAP = 2; // matches cm-merge-gap width in CSS
      const rightPx = totalW - leftPx - GAP;
      if (paneA) { paneA.style.width = `${leftPx}px`; paneA.style.flex = "none"; }
      if (paneB) { paneB.style.width = `${Math.max(80, rightPx)}px`; paneB.style.flex = "none"; }
      setResizerLeft(leftPx + GAP / 2);
    };

    // Initial 50/50 — use rAF so MergeView has painted and mount has a width
    const initRaf = requestAnimationFrame(() => {
      const totalW = mount.getBoundingClientRect().width;
      applyWidths(Math.floor((totalW - 2) / 2));
    });

    // --- scroll sync ---
    const cleanA = attachScrollSync(merge.a, () => viewBRef.current);
    const cleanB = attachScrollSync(merge.b, () => viewARef.current);

    // --- drag-to-resize ---
    const resizer = resizerRef.current;
    let dragging = false;
    let startX = 0;
    let startLeftW = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const totalW = mount.getBoundingClientRect().width;
      const newLeft = Math.max(80, Math.min(totalW - 82, startLeftW + (e.clientX - startX)));
      applyWidths(newLeft);
    };

    const onMouseUp = () => {
      dragging = false;
      resizer?.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startLeftW = paneA ? paneA.getBoundingClientRect().width : mount.getBoundingClientRect().width / 2;
      resizer?.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    resizer?.addEventListener("mousedown", onMouseDown);

    cleanupsRef.current = [
      cleanA, cleanB,
      () => cancelAnimationFrame(initRaf),
      () => resizer?.removeEventListener("mousedown", onMouseDown),
      () => onMouseUp(),
    ];

    return () => {
      cleanupsRef.current.forEach((f) => f());
      cleanupsRef.current = [];
      merge.destroy();
      mergeRef.current = null;
      viewARef.current = null;
      viewBRef.current = null;
    };
  }, [filePath, oldContent, newContent, editorTheme]);

  return (
    <div
      ref={shellRef}
      style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--surface-container-low,#12131a)" }}
    >
      {/* breadcrumb */}
      <PathBreadcrumb filePath={filePath} commitHash={commitHash} onOpenFile={onOpenFile} />

      {/* pane label headers */}
      <div style={{ display: "flex", flexDirection: "row", flexShrink: 0, borderBottom: "1px solid rgba(232,234,240,0.06)" }}>
        <div style={{ flex: 1, minWidth: 0, height: 26, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: "rgba(0,0,0,0.12)" }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(232,234,240,0.28)" }}>{oldLabel}</span>
        </div>
        {/* visual gap spacer — matches the 2px cm-merge-gap */}
        <div style={{ width: 2, background: "rgba(232,234,240,0.07)", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, height: 26, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: "rgba(0,0,0,0.12)" }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(232,234,240,0.28)" }}>{newLabel}</span>
        </div>
      </div>

      {/* editor mount: relative so resizer pill is absolute inside it */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
        {/* MergeView mounts here — scoped with aurora-diff-inner */}
        <div
          ref={mountRef}
          className="aurora-diff-inner"
          style={{ height: "100%", width: "100%" }}
        />
        {/* drag handle — rendered as absolute pill over the gap */}
        <div
          ref={resizerRef}
          className="aurora-diff-resizer"
          style={{ left: resizerLeft !== null ? resizerLeft : "50%" }}
        />
      </div>
    </div>
  );
}