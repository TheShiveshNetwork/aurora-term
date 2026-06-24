import { useMemo, useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { EditorView as EditorViewClass, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { EDITOR_THEMES } from "./editorThemes";
import { showMinimap } from "@replit/codemirror-minimap";

// ─── minimap ──────────────────────────────────────────────────────────────────
const minimapCreate = () => ({ dom: document.createElement("div") });
const minimapExtension = showMinimap.compute(["doc"], () => ({
  create: minimapCreate,
  displayText: "characters" as const,
  showOverlay: "always" as const,
}));

// ─── global styles ────────────────────────────────────────────────────────────
const STYLE_ID = "aurora-commit-diff-style";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .aurora-diff-add  { background: rgba(80, 227, 194, 0.10); display: block; }
    .aurora-diff-del  { background: rgba(255,  70,  70, 0.09); display: block; }
    .aurora-diff-hdr  { background: rgba( 79, 140, 255, 0.08); display: block; color: rgba(79,140,255,0.7); }
    .cm-gutters       { background: transparent !important; border-right: 1px solid rgba(232,234,240,0.06) !important; }
    .cm-activeLineGutter { background: transparent !important; }
    .cm-activeLine    { background: rgba(255,255,255,0.022) !important; }
    .cm-minimap       { border-left: 1px solid rgba(232,234,240,0.05) !important; opacity: 0.72; }
    .cm-minimap-overlay { background: rgba(232,234,240,0.07) !important; border: 1px solid rgba(232,234,240,0.13) !important; }
  `;
  document.head.appendChild(s);
}

// ─── diff line decoration plugin ──────────────────────────────────────────────
// Range<Decoration>[] is the correct type for Decoration.set()
const diffLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = this.build(u.view);
      }
    }

    build(view: EditorView): DecorationSet {
      // collect Range<Decoration> — NOT Decoration — that's what Decoration.set expects
      const ranges: Range<Decoration>[] = [];

      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          const first = line.text[0];

          // Decoration.line({...}).range(from) returns Range<Decoration> ✓
          if (first === "+") {
            ranges.push(Decoration.line({ class: "aurora-diff-add" }).range(line.from));
          } else if (first === "-") {
            ranges.push(Decoration.line({ class: "aurora-diff-del" }).range(line.from));
          } else if (first === "@") {
            ranges.push(Decoration.line({ class: "aurora-diff-hdr" }).range(line.from));
          }

          pos = line.to + 1;
        }
      }

      // Decoration.set requires ranges sorted by from position (they already are
      // since we walk linearly), and the second arg true = already sorted
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (v) => v.decorations }
);

// ─── path breadcrumb ──────────────────────────────────────────────────────────
function PathBreadcrumb({ filePath, commitHash }: { filePath: string; commitHash: string }) {
  const parts = filePath.replace(/^\/+/, "").split("/").filter(Boolean);
  const display = parts.length > 0 ? parts : [filePath || `commit ${commitHash.slice(0, 7)}`];

  return (
    <div
      className="flex items-center justify-between shrink-0 border-b px-3"
      style={{ height: 34, borderColor: "rgba(232,234,240,0.07)", background: "rgba(0,0,0,0.20)" }}
    >
      <div className="flex items-center gap-0.5 min-w-0 overflow-hidden font-mono" style={{ fontSize: 11 }}>
        {display.map((part, i) => {
          const isFile = i === display.length - 1;
          return (
            <span key={i} className="flex items-center shrink-0">
              {i > 0 && <span style={{ color: "rgba(232,234,240,0.2)", margin: "0 2px" }}>/</span>}
              <span style={{
                color: isFile ? "rgba(232,234,240,0.88)" : "rgba(232,234,240,0.38)",
                fontWeight: isFile ? 500 : 400,
                maxWidth: isFile ? 280 : 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "inline-block",
              }}>
                {part}
              </span>
            </span>
          );
        })}
      </div>

      <span className="font-mono px-1.5 py-0.5 rounded shrink-0 ml-3" style={{
        fontSize: 9, color: "rgba(232,234,240,0.35)",
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(232,234,240,0.08)",
      }}>
        {commitHash.slice(0, 7)}
      </span>
    </div>
  );
}

// ─── CommitDiffView ───────────────────────────────────────────────────────────
export function CommitDiffView({
  diff,
  commitHash,
  filePath = "",
}: {
  diff: string;
  commitHash: string;
  filePath?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editorTheme = useSettingsStore((s) => s.editorTheme);

  const extensions = useMemo((): Extension[] => [
    basicSetup,
    EDITOR_THEMES[editorTheme],
    minimapExtension,
    diffLinePlugin,
    EditorViewClass.editable.of(false),
    EditorState.readOnly.of(true),
    EditorViewClass.theme({
      "&": { backgroundColor: "transparent", height: "100%" },
      ".cm-gutters": { backgroundColor: "transparent" },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.022)" },
      ".cm-scroller": {
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: "12px",
        lineHeight: "1.65",
      },
      ".cm-content": { padding: "4px 0" },
    }),
  ], [editorTheme]);

  useEffect(() => {
    if (!containerRef.current) return;
    viewRef.current?.destroy();

    const view = new EditorView({
      state: EditorState.create({ doc: diff, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [diff, extensions]);

  return (
    <div className="h-full w-full flex flex-col" style={{ background: "var(--surface-container-low, #12131a)", minHeight: 0 }}>
      <PathBreadcrumb filePath={filePath} commitHash={commitHash} />
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}