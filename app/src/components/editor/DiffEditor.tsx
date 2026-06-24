import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { MergeView } from "@codemirror/merge";
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
import { EditorView as EditorViewClass } from "@codemirror/view";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { EDITOR_THEMES } from "./editorThemes";
import { showMinimap } from "@replit/codemirror-minimap";

// ─── language detection ───────────────────────────────────────────────────────
function getLanguageExtension(filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "js": case "jsx": case "ts": case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "py": return python();
    case "json": return json();
    case "rs": return rust();
    case "html": case "htm": return html();
    case "css": case "scss": case "sass": return css();
    case "xml": case "svg": return xml();
    case "md": case "mdx": return markdown();
    case "sql": return sql();
    case "yaml": case "yml": return yaml();
    case "sh": case "bash": case "zsh": return StreamLanguage.define(shell);
    case "go": return StreamLanguage.define(go);
    case "java": return StreamLanguage.define(java);
    case "c": case "cpp": case "cc": case "cxx": case "h": case "hpp":
      return StreamLanguage.define(cpp);
    default: return [];
  }
}

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

// ─── minimap ──────────────────────────────────────────────────────────────────
const minimapCreate = () => ({ dom: document.createElement("div") });
function makeMinimap() {
  return showMinimap.compute(["doc"], () => ({
    create: minimapCreate,
    displayText: "characters" as const,
    showOverlay: "always" as const,
  }));
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

// ─── breadcrumb ───────────────────────────────────────────────────────────────
function PathBreadcrumb({ filePath, commitHash, onOpenFile }: {
  filePath: string; commitHash?: string; onOpenFile?: (p: string) => void;
}) {
  const parts = filePath.replace(/^\/+/, "").split("/").filter(Boolean);

  return (
    <div className="flex items-center justify-between shrink-0 border-b px-3"
      style={{ height: 34, borderColor: "rgba(232,234,240,0.07)", background: "rgba(0,0,0,0.20)" }}>

      <div className="flex items-center gap-0.5 min-w-0 overflow-hidden font-mono" style={{ fontSize: 11 }}>
        {parts.map((part, i) => {
          const isFile = i === parts.length - 1;
          const partial = "/" + parts.slice(0, i + 1).join("/");
          return (
            <span key={i} className="flex items-center shrink-0">
              {i > 0 && <span style={{ color: "rgba(232,234,240,0.18)", margin: "0 2px" }}>/</span>}
              <span title={partial} onClick={() => !isFile && onOpenFile?.(partial)}
                style={{
                  color: isFile ? "rgba(232,234,240,0.88)" : "rgba(232,234,240,0.38)",
                  fontWeight: isFile ? 500 : 400,
                  cursor: !isFile && onOpenFile ? "pointer" : "default",
                  maxWidth: isFile ? 260 : 120,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block",
                }}
                onMouseEnter={(e) => { if (!isFile && onOpenFile) e.currentTarget.style.color = "rgba(232,234,240,0.75)"; }}
                onMouseLeave={(e) => { if (!isFile) e.currentTarget.style.color = "rgba(232,234,240,0.38)"; }}
              >{part}</span>
            </span>
          );
        })}
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-3">
        {commitHash && (
          <span className="font-mono px-1.5 py-0.5 rounded"
            style={{ fontSize: 9, color: "rgba(232,234,240,0.35)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(232,234,240,0.08)" }}>
            {commitHash.slice(0, 7)}
          </span>
        )}
        {onOpenFile && (
          <button onClick={() => onOpenFile(filePath)}
            style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(232,234,240,0.38)", background: "transparent", border: "1px solid rgba(232,234,240,0.1)", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#E8EAF0"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(232,234,240,0.38)"; e.currentTarget.style.background = "transparent"; }}
          >↗ open</button>
        )}
      </div>
    </div>
  );
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

    const editorThemeExt = EditorViewClass.theme({
      "&": { backgroundColor: "transparent", height: "100%" },
      ".cm-gutters": { backgroundColor: "transparent" },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.022)" },
      ".cm-scroller": { fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace", fontSize: "12px", lineHeight: "1.65" },
      ".cm-content": { padding: "4px 0" },
    });

    const base = [
      basicSetup,
      EDITOR_THEMES[editorTheme],
      makeMinimap(),
      EditorViewClass.editable.of(false),
      EditorState.readOnly.of(true),
      editorThemeExt,
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