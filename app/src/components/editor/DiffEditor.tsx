import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import type { MergeView } from "@codemirror/merge";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { getEditorTheme, createThemeCompartment, READONLY_EDITOR_THEME } from "./editorThemes";
import { createMinimapExtension } from "./minimapExtension";
import { getLanguageExtension } from "../../lib/codeLang";
import { PathBreadcrumb } from "./PathBreadcrumb";

// ─── global styles injected once ─────────────────────────────────────────────
const STYLE_ID = "aurora-diff-style";
if (typeof document !== "undefined") {
  let s = document.getElementById(STYLE_ID) as HTMLStyleElement;
  if (!s) {
    s = document.createElement("style");
    s.id = STYLE_ID;
    document.head.appendChild(s);
  }
  s.textContent = `
    /* The wrapper we control is a flex row — MergeView fills it */
    .aurora-diff-inner             { display: flex; flex-direction: row; width: 100%; height: 100%; overflow: hidden; }

    /* MergeView root — fill the wrapper */
    .aurora-diff-inner .cm-mergeView      { flex: 1; display: flex; flex-direction: row; height: 100% !important; min-width: 0; overflow: hidden !important; }
    .aurora-diff-inner .cm-mergeViewEditors { display: flex; flex-direction: row; height: 100% !important; width: 100%; min-height: 0; }
    .aurora-diff-inner .cm-merge-2pane    { flex: 1; display: flex; flex-direction: row; height: 100% !important; min-width: 0; overflow: hidden !important; }

    /* Each pane: fixed width set imperatively after mount */
    .aurora-diff-inner .cm-mergeViewEditor          { display: flex; flex-direction: column; height: 100% !important; overflow: hidden !important; min-width: 0; }
    .aurora-diff-inner .cm-mergeViewEditor .cm-editor    { flex: 1; display: flex; flex-direction: column; min-height: 0; height: 100% !important; }
    .aurora-diff-inner .cm-mergeViewEditor .cm-scroller  { height: 100% !important; overflow: auto !important; }

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
  const themeCompartmentARef = useRef<Compartment>(createThemeCompartment());
  const themeCompartmentBRef = useRef<Compartment>(createThemeCompartment());
  const wordWrapCompartmentARef = useRef<Compartment>(new Compartment());
  const wordWrapCompartmentBRef = useRef<Compartment>(new Compartment());
  const headerARef = useRef<HTMLDivElement>(null);
  const headerBRef = useRef<HTMLDivElement>(null);
  const cleanupsRef = useRef<(() => void)[]>([]);

  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const wordWrap = useSettingsStore((s) => s.wordWrap);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- destroy previous ---
    cleanupsRef.current.forEach((f) => f());
    cleanupsRef.current = [];
    mergeRef.current?.destroy();
    mergeRef.current = null;
    viewARef.current = null;
    viewBRef.current = null;

    let cancelled = false;

    Promise.all([
      import("codemirror"),
      import("@codemirror/state"),
      import("@codemirror/merge"),
      import("@codemirror/view"),
      getLanguageExtension(filePath),
    ]).then(([
      { basicSetup },
      { EditorState },
      { MergeView },
      { EditorView: EditorViewClass },
      langExt,
    ]) => {
      if (cancelled) return;

      const base = [
        basicSetup,
        createMinimapExtension(true),
        EditorViewClass.editable.of(false),
        EditorState.readOnly.of(true),
        READONLY_EDITOR_THEME,
        ...(langExt.length > 0 ? langExt : []),
      ];

      const baseA = [
        ...base,
        themeCompartmentARef.current.of([]),
        wordWrapCompartmentARef.current.of(wordWrap ? EditorViewClass.lineWrapping : []),
      ];
      const baseB = [
        ...base,
        themeCompartmentBRef.current.of([]),
        wordWrapCompartmentBRef.current.of(wordWrap ? EditorViewClass.lineWrapping : []),
      ];

      const merge = new MergeView({
        a: { doc: oldContent, extensions: baseA },
        b: { doc: newContent, extensions: baseB },
        parent: mount,
        orientation: "a-b",
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
      });

      mergeRef.current = merge;
      viewARef.current = merge.a;
      viewBRef.current = merge.b;

      // Apply initial theme to both panes
      getEditorTheme(editorTheme).then(theme => {
        const viewA = viewARef.current;
        const viewB = viewBRef.current;
        if (viewA && viewB) {
          viewA.dispatch({ effects: themeCompartmentARef.current.reconfigure(theme) });
          viewB.dispatch({ effects: themeCompartmentBRef.current.reconfigure(theme) });
        }
      });

      const ratioRef = { current: 0.5 };

      const applyWidths = () => {
        const rect = mount.getBoundingClientRect();
        const totalW = rect.width;
        if (totalW <= 0) return; // wait until container has size

        const panes = mount.querySelectorAll<HTMLElement>(".cm-mergeViewEditor");
        const paneA = panes[0];
        const paneB = panes[1];
        if (!paneA || !paneB) return; // wait until panes are in the DOM

        const GAP = 2;
        const leftPx = Math.max(80, Math.min(totalW - 82, Math.floor(totalW * ratioRef.current)));
        const rightPx = totalW - leftPx - GAP;

        paneA.style.width = `${leftPx}px`;
        paneA.style.flex = "none";
        paneB.style.width = `${Math.max(80, rightPx)}px`;
        paneB.style.flex = "none";
        if (headerARef.current) { headerARef.current.style.width = `${leftPx}px`; headerARef.current.style.flex = "none"; }
        if (headerBRef.current) { headerBRef.current.style.width = `${Math.max(80, rightPx)}px`; headerBRef.current.style.flex = "none"; }
        setResizerLeft(leftPx + GAP / 2);
      };

      const resizeObserver = new ResizeObserver(() => {
        applyWidths();
      });
      resizeObserver.observe(mount);

      const cleanA = attachScrollSync(merge.a, () => viewBRef.current);
      const cleanB = attachScrollSync(merge.b, () => viewARef.current);

      const resizer = resizerRef.current;
      let dragging = false;
      let startX = 0;
      let startLeftW = 0;

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging) return;
        const rect = mount.getBoundingClientRect();
        const totalW = rect.width;
        if (totalW <= 0) return;
        const newLeft = Math.max(80, Math.min(totalW - 82, startLeftW + (e.clientX - startX)));
        ratioRef.current = newLeft / totalW;
        applyWidths();
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
        const paneA = mount.querySelector<HTMLElement>(".cm-mergeViewEditor");
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
        () => resizeObserver.disconnect(),
        () => resizer?.removeEventListener("mousedown", onMouseDown),
        () => onMouseUp(),
      ];
    });

    return () => {
      cancelled = true;
      cleanupsRef.current.forEach((f) => f());
      cleanupsRef.current = [];
      mergeRef.current?.destroy();
      mergeRef.current = null;
      viewARef.current = null;
      viewBRef.current = null;
    };
  }, [filePath, oldContent, newContent]);

  useEffect(() => {
    const viewA = viewARef.current;
    const viewB = viewBRef.current;
    if (!viewA || !viewB) return;
    getEditorTheme(editorTheme).then(theme => {
      if (viewARef.current !== viewA || viewBRef.current !== viewB) return;
      viewA.dispatch({ effects: themeCompartmentARef.current.reconfigure(theme) });
      viewB.dispatch({ effects: themeCompartmentBRef.current.reconfigure(theme) });
    });
  }, [editorTheme]);

  useEffect(() => {
    const viewA = viewARef.current;
    const viewB = viewBRef.current;
    if (!viewA || !viewB) return;
    import("@codemirror/view").then(({ EditorView }) => {
      if (viewARef.current === viewA && viewBRef.current === viewB) {
        viewA.dispatch({
          effects: wordWrapCompartmentARef.current.reconfigure(wordWrap ? EditorView.lineWrapping : [])
        });
        viewB.dispatch({
          effects: wordWrapCompartmentBRef.current.reconfigure(wordWrap ? EditorView.lineWrapping : [])
        });
      }
    });
  }, [wordWrap]);

  return (
    <div
      ref={shellRef}
      style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--surface-container-low,#12131a)" }}
    >
      {/* breadcrumb */}
      <PathBreadcrumb filePath={filePath} commitHash={commitHash} onOpenFile={onOpenFile} />

      {/* pane label headers */}
      <div style={{ display: "flex", flexDirection: "row", flexShrink: 0, borderBottom: "1px solid rgba(232,234,240,0.06)" }}>
        <div
          ref={headerARef}
          style={{ minWidth: 0, height: 26, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: "rgba(0,0,0,0.12)" }}
        >
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(232,234,240,0.28)" }}>{oldLabel}</span>
        </div>
        {/* visual gap spacer — matches the 2px cm-merge-gap */}
        <div style={{ width: 2, background: "rgba(232,234,240,0.07)", flexShrink: 0 }} />
        <div
          ref={headerBRef}
          style={{ minWidth: 0, height: 26, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: "rgba(0,0,0,0.12)" }}
        >
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