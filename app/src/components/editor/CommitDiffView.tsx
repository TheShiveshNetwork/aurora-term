import { useMemo, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { Extension, Range, Compartment } from "@codemirror/state";
import type { Decoration, DecorationSet, ViewUpdate } from "@codemirror/view";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { getEditorTheme, createThemeCompartment, READONLY_EDITOR_THEME } from "./editorThemes";
import { createMinimapExtension } from "./minimapExtension";
import { PathBreadcrumb } from "./PathBreadcrumb";

const STYLE_ID = "aurora-commit-diff-style";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .aurora-diff-add  { background: rgba(80, 227, 194, 0.10); display: block; }
    .aurora-diff-del  { background: rgba(255,  70,  70, 0.09); display: block; }
    .aurora-diff-hdr  { background: rgba( 79, 140, 255, 0.08); display: block; color: rgba(79,140,255,0.7); }
    .aurora-collapsed { cursor: pointer; background: rgba(255,255,255,0.02); display: block; }
    .aurora-collapsed:hover { background: rgba(79, 140, 255, 0.06); }
    .cm-gutters       { background: transparent !important; border-right: 1px solid rgba(232,234,240,0.06) !important; }
    .cm-activeLineGutter { background: transparent !important; }
    .cm-activeLine    { background: rgba(255,255,255,0.022) !important; }
    .cm-minimap       { border-left: 1px solid rgba(232,234,240,0.05) !important; opacity: 0.72; }
    .cm-minimap-overlay { background: rgba(232,234,240,0.07) !important; border: 1px solid rgba(232,234,240,0.13) !important; }
  `;
  document.head.appendChild(s);
}



type DiffBlock = { kind: "hdr"; lines: string[] } | { kind: "ctx"; lines: string[] } | { kind: "chg"; lines: string[] };

function parseDiffBlocks(diff: string): DiffBlock[] {
  const lines: string[] = [];
  for (const l of diff.split("\n")) {
    const t = l.replace(/\r$/, "");
    if (t.length > 0) lines.push(t);
  }

  const blocks: DiffBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const c = lines[i][0];
    if (c === "@") {
      const hdr: string[] = [];
      while (i < lines.length && lines[i][0] === "@") {
        hdr.push(lines[i]); i++;
      }
      blocks.push({ kind: "hdr", lines: hdr });
    } else if (c === " " || c === "") {
      const ctx: string[] = [];
      while (i < lines.length && (lines[i][0] === " " || lines[i] === "")) {
        ctx.push(lines[i]); i++;
      }
      if (ctx.length > 0) blocks.push({ kind: "ctx", lines: ctx });
    } else {
      const chg: string[] = [];
      while (i < lines.length && lines[i][0] !== " " && lines[i][0] !== "@" && lines[i] !== "") {
        chg.push(lines[i]); i++;
      }
      if (chg.length > 0) blocks.push({ kind: "chg", lines: chg });
    }
  }
  return blocks;
}

function computeFileLineNumbers(diff: string): number[] {
  const lines = diff.split("\n");
  const nums: number[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const t = line.replace(/\r$/, "");
    if (t.startsWith("@@")) {
      const om = t.match(/-(\d+)/);
      const nm = t.match(/\+(\d+)/);
      if (om) oldLine = Number(om[1]);
      if (nm) newLine = Number(nm[1]);
      nums.push(0);
    } else if (t.startsWith("+")) {
      nums.push(newLine++);
    } else if (t.startsWith("-")) {
      nums.push(oldLine++);
    } else if (t.startsWith(" ")) {
      nums.push(newLine++);
      oldLine++;
    } else if (t.startsWith("…")) {
      nums.push(0);
    } else {
      nums.push(0);
    }
  }

  return nums;
}

function buildCollapsedText(blocks: DiffBlock[], expanded: Set<number>): { text: string; lineToBlock: number[]; fileLineNums: number[] } {
  const out: string[] = [];
  const lineToBlock: number[] = [];
  const fileLineNums: number[] = [];
  let oldLine = 0;
  let newLine = 0;

  function flushLine(line: string) {
    const c = line[0] ?? "";
    if (c === "@") {
      const om = line.match(/-(\d+)/);
      const nm = line.match(/\+(\d+)/);
      if (om) oldLine = Number(om[1]);
      if (nm) newLine = Number(nm[1]);
      fileLineNums.push(0);
    } else if (c === "+") {
      fileLineNums.push(newLine++);
    } else if (c === "-") {
      fileLineNums.push(oldLine++);
    } else if (c === " ") {
      fileLineNums.push(newLine++);
      oldLine++;
    } else {
      fileLineNums.push(0);
    }
    out.push(line);
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "ctx" || expanded.has(i) || b.lines.length <= 3) {
      for (let j = 0; j < b.lines.length; j++) {
        lineToBlock.push(-1);
        flushLine(b.lines[j]);
      }
    } else {
      out.push(`… ${b.lines.length} unchanged lines …`);
      lineToBlock.push(i);
      fileLineNums.push(0);
      oldLine += b.lines.length;
      newLine += b.lines.length;
    }
  }
  return { text: out.join("\n"), lineToBlock, fileLineNums };
}

export function CommitDiffView({
  diff,
  commitHash,
  filePath = "",
  showBreadcrumb = true,
  collapsible = false,
}: {
  diff: string;
  commitHash: string;
  filePath?: string;
  showBreadcrumb?: boolean;
  collapsible?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef<Compartment>(createThemeCompartment());
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const lineToBlockRef = useRef<number[]>([]);
  const fileLineNumsRef = useRef<number[]>([]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const blocks = useMemo(() => (collapsible ? parseDiffBlocks(diff) : []), [collapsible, diff]);

  const collapsedText = useMemo(() => {
    if (!collapsible) {
      fileLineNumsRef.current = computeFileLineNumbers(diff);
      return diff;
    }
    const { text, lineToBlock, fileLineNums } = buildCollapsedText(blocks, expanded);
    lineToBlockRef.current = lineToBlock;
    fileLineNumsRef.current = fileLineNums;
    return text;
  }, [collapsible, blocks, expanded, diff]);



  const collapsibleRef = useRef(collapsible);
  collapsibleRef.current = collapsible;



  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    viewRef.current?.destroy();
    viewRef.current = null;
    let cancelled = false;

    Promise.all([
      import("codemirror"),
      import("@codemirror/state"),
      import("@codemirror/view"),
    ]).then(([
      { EditorView, basicSetup },
      { EditorState },
      { EditorView: EditorViewClass, ViewPlugin, Decoration, lineNumbers },
    ]) => {
      if (cancelled) return;

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
            const ranges: Range<Decoration>[] = [];

            for (const { from, to } of view.visibleRanges) {
              let pos = from;
              while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                const first = line.text[0];

                if (first === "+") {
                  ranges.push(Decoration.line({ class: "aurora-diff-add" }).range(line.from));
                } else if (first === "-") {
                  ranges.push(Decoration.line({ class: "aurora-diff-del" }).range(line.from));
                } else if (first === "@") {
                  ranges.push(Decoration.line({ class: "aurora-diff-hdr" }).range(line.from));
                } else if (first === "…") {
                  ranges.push(Decoration.line({ class: "aurora-collapsed" }).range(line.from));
                }

                pos = line.to + 1;
              }
            }

            return Decoration.set(ranges, true);
          }
        },
        { decorations: (v) => v.decorations }
      );

      const customLineNumbers = lineNumbers({
        formatNumber: (n: number) => {
          const v = fileLineNumsRef.current[n - 1];
          return v > 0 ? String(v) : "";
        },
      });

      const collapsedClickHandler = EditorViewClass.domEventHandlers({
        mousedown: (event: MouseEvent, view: EditorView) => {
          if (!collapsibleRef.current) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;
          const line = view.state.doc.lineAt(pos);
          if (!line.text.startsWith("… ")) return false;
          const lineNr = line.number - 1;
          const blockIdx = lineToBlockRef.current[lineNr];
          if (blockIdx !== undefined && blockIdx >= 0) {
            event.preventDefault();
            setExpanded(prev => {
              const next = new Set(prev);
              if (next.has(blockIdx)) next.delete(blockIdx);
              else next.add(blockIdx);
              return next;
            });
            return true;
          }
          return false;
        },
      });

      const view = new EditorView({
        state: EditorState.create({
          doc: collapsedText,
          extensions: [
            basicSetup,
            createMinimapExtension(true),
            diffLinePlugin,
            EditorViewClass.editable.of(false),
            EditorState.readOnly.of(true),
            READONLY_EDITOR_THEME,
            customLineNumbers,
            collapsedClickHandler,
            themeCompartmentRef.current.of([]),
          ],
        }),
        parent: el,
      });
      viewRef.current = view;

      getEditorTheme(editorTheme).then(theme => {
        if (viewRef.current === view) {
          view.dispatch({ effects: themeCompartmentRef.current.reconfigure(theme) });
        }
      });
    });

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [collapsedText]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    getEditorTheme(editorTheme).then(theme => {
      if (viewRef.current !== view) return;
      view.dispatch({ effects: themeCompartmentRef.current.reconfigure(theme) });
    });
  }, [editorTheme]);

  return (
    <div className="h-full w-full flex flex-col" style={{ background: "var(--surface-container-low, #12131a)", minHeight: 0 }}>
      {showBreadcrumb && <PathBreadcrumb filePath={filePath} commitHash={commitHash} />}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
