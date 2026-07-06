import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { getEditorTheme, createThemeCompartment, READONLY_EDITOR_THEME } from "./editorThemes";
import { createMinimapExtension } from "./minimapExtension";
import { getLanguageExtension } from "../../lib/codeLang";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { mergeConflictResolver } from "./mergeConflictExtension";
import { system } from "../../lib/ipc";
import { Button } from "../ui/Button";
import { AlertCircle, Check, X } from "lucide-react";

// Helper to count conflict blocks remaining in the text
function countConflicts(text: string): number {
  const matches = text.match(/^<<<<<</gm);
  return matches ? matches.length : 0;
}

// Scroll sync helper for Ours and Theirs editors
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

// Clean parser for Ours and Theirs views
export function parseMergeConflicts(content: string) {
  const lines = content.split(/\r?\n/);
  const oursLines: string[] = [];
  const theirsLines: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("<<<<<<<")) {
      i++; // Skip <<<<<<<
      // Read ours
      while (i < lines.length && !lines[i].startsWith("=======") && !lines[i].startsWith("|||||||")) {
        oursLines.push(lines[i]);
        i++;
      }
      // If there is a base block (|||||||), skip it
      if (i < lines.length && lines[i].startsWith("|||||||")) {
        i++;
        while (i < lines.length && !lines[i].startsWith("=======")) {
          i++;
        }
      }
      // Skip =======
      if (i < lines.length && lines[i].startsWith("=======")) {
        i++;
      }
      // Read theirs
      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        theirsLines.push(lines[i]);
        i++;
      }
      // Skip >>>>>>>
      if (i < lines.length && lines[i].startsWith(">>>>>>>")) {
        i++;
      }
    } else {
      oursLines.push(line);
      theirsLines.push(line);
      i++;
    }
  }

  return {
    ours: oursLines.join("\n"),
    theirs: theirsLines.join("\n"),
    result: content,
  };
}

interface MergeEditorProps {
  filePath: string;
  cwd: string;
  onClose: () => void;
  onSave?: () => void;
}

export function MergeEditor({ filePath, cwd, onClose, onSave }: MergeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountOursRef = useRef<HTMLDivElement>(null);
  const mountTheirsRef = useRef<HTMLDivElement>(null);
  const mountResultRef = useRef<HTMLDivElement>(null);

  const viewOursRef = useRef<EditorView | null>(null);
  const viewTheirsRef = useRef<EditorView | null>(null);
  const viewResultRef = useRef<EditorView | null>(null);

  const themeCompartmentOurs = useRef<Compartment>(createThemeCompartment());
  const themeCompartmentTheirs = useRef<Compartment>(createThemeCompartment());
  const themeCompartmentResult = useRef<Compartment>(createThemeCompartment());

  const wordWrapCompartmentOurs = useRef<Compartment>(new Compartment());
  const wordWrapCompartmentTheirs = useRef<Compartment>(new Compartment());
  const wordWrapCompartmentResult = useRef<Compartment>(new Compartment());

  const cleanupsRef = useRef<(() => void)[]>([]);

  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const wordWrap = useSettingsStore((s) => s.wordWrap);

  const [loading, setLoading] = useState(true);
  const [conflictCount, setConflictCount] = useState(0);
  const [parsedData, setParsedData] = useState<{ ours: string; theirs: string; result: string } | null>(null);

  // Load conflicted file and parse it
  useEffect(() => {
    let active = true;
    setLoading(true);
    system.readFileContent(filePath)
      .then((content) => {
        if (!active) return;
        const parsed = parseMergeConflicts(content);
        setParsedData(parsed);
        setConflictCount(countConflicts(content));
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load merge conflict file:", err);
        setLoading(false);
      });

    return () => { active = false; };
  }, [filePath]);

  // Setup CodeMirror instances once parsedData is loaded
  useEffect(() => {
    if (loading || !parsedData) return;

    // Destroy existing editors
    cleanupsRef.current.forEach((f) => f());
    cleanupsRef.current = [];
    viewOursRef.current?.destroy();
    viewTheirsRef.current?.destroy();
    viewResultRef.current?.destroy();

    let cancelled = false;

    Promise.all([
      import("codemirror"),
      import("@codemirror/state"),
      import("@codemirror/view"),
      getLanguageExtension(filePath),
    ]).then(([
      { basicSetup, EditorView: EditorViewClass },
      { EditorState },
      { EditorView: EditorViewClass2 },
      langExt,
    ]) => {
      if (cancelled) return;

      const baseExt = [
        basicSetup,
        createMinimapExtension(true),
        ...(langExt.length > 0 ? langExt : []),
      ];

      // 1. Ours Editor (Read-Only)
      const viewOurs = new EditorView({
        state: EditorState.create({
          doc: parsedData.ours,
          extensions: [
            ...baseExt,
            EditorViewClass2.editable.of(false),
            EditorState.readOnly.of(true),
            READONLY_EDITOR_THEME,
            themeCompartmentOurs.current.of([]),
            wordWrapCompartmentOurs.current.of(wordWrap ? EditorViewClass2.lineWrapping : []),
          ],
        }),
        parent: mountOursRef.current!,
      });
      viewOursRef.current = viewOurs;

      // 2. Theirs Editor (Read-Only)
      const viewTheirs = new EditorView({
        state: EditorState.create({
          doc: parsedData.theirs,
          extensions: [
            ...baseExt,
            EditorViewClass2.editable.of(false),
            EditorState.readOnly.of(true),
            READONLY_EDITOR_THEME,
            themeCompartmentTheirs.current.of([]),
            wordWrapCompartmentTheirs.current.of(wordWrap ? EditorViewClass2.lineWrapping : []),
          ],
        }),
        parent: mountTheirsRef.current!,
      });
      viewTheirsRef.current = viewTheirs;

      // 3. Result Editor (Editable, with merge conflict resolution widgets)
      const updateListener = EditorViewClass2.updateListener.of((update) => {
        if (update.docChanged) {
          const text = update.state.doc.toString();
          setConflictCount(countConflicts(text));
        }
      });

      const viewResult = new EditorView({
        state: EditorState.create({
          doc: parsedData.result,
          extensions: [
            ...baseExt,
            updateListener,
            mergeConflictResolver(),
            themeCompartmentResult.current.of([]),
            wordWrapCompartmentResult.current.of(wordWrap ? EditorViewClass2.lineWrapping : []),
          ],
        }),
        parent: mountResultRef.current!,
      });
      viewResultRef.current = viewResult;

      // Apply current themes
      getEditorTheme(editorTheme).then((theme) => {
        if (cancelled) return;
        viewOurs.dispatch({ effects: themeCompartmentOurs.current.reconfigure(theme) });
        viewTheirs.dispatch({ effects: themeCompartmentTheirs.current.reconfigure(theme) });
        viewResult.dispatch({ effects: themeCompartmentResult.current.reconfigure(theme) });
      });

      // Attach scroll sync between Ours and Theirs
      const clean1 = attachScrollSync(viewOurs, () => viewTheirsRef.current);
      const clean2 = attachScrollSync(viewTheirs, () => viewOursRef.current);
      cleanupsRef.current.push(clean1, clean2);
    });

    return () => {
      cancelled = true;
      cleanupsRef.current.forEach((f) => f());
      cleanupsRef.current = [];
      viewOursRef.current?.destroy();
      viewTheirsRef.current?.destroy();
      viewResultRef.current?.destroy();
    };
  }, [loading, parsedData]);

  // Re-apply theme when editorTheme setting updates
  useEffect(() => {
    const vO = viewOursRef.current;
    const vT = viewTheirsRef.current;
    const vR = viewResultRef.current;
    if (!vO || !vT || !vR) return;

    getEditorTheme(editorTheme).then((theme) => {
      if (viewOursRef.current === vO) vO.dispatch({ effects: themeCompartmentOurs.current.reconfigure(theme) });
      if (viewTheirsRef.current === vT) vT.dispatch({ effects: themeCompartmentTheirs.current.reconfigure(theme) });
      if (viewResultRef.current === vR) vR.dispatch({ effects: themeCompartmentResult.current.reconfigure(theme) });
    });
  }, [editorTheme]);

  // Re-apply wordWrap when setting updates
  useEffect(() => {
    const vO = viewOursRef.current;
    const vT = viewTheirsRef.current;
    const vR = viewResultRef.current;
    if (!vO || !vT || !vR) return;

    import("@codemirror/view").then(({ EditorView }) => {
      if (viewOursRef.current === vO) {
        vO.dispatch({ effects: wordWrapCompartmentOurs.current.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
      }
      if (viewTheirsRef.current === vT) {
        vT.dispatch({ effects: wordWrapCompartmentTheirs.current.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
      }
      if (viewResultRef.current === vR) {
        vR.dispatch({ effects: wordWrapCompartmentResult.current.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
      }
    });
  }, [wordWrap]);

  // Save resolved content back to file
  const handleSaveResolution = useCallback(async () => {
    if (!viewResultRef.current) return;
    const text = viewResultRef.current.state.doc.toString();
    const remaining = countConflicts(text);

    if (remaining > 0) {
      const confirmSave = confirm(`There are still ${remaining} conflict marker(s) remaining. Save anyway?`);
      if (!confirmSave) return;
    }

    try {
      await system.writeFileContent(filePath, text);
      if (onSave) onSave();
      onClose();
    } catch (err) {
      alert(`Failed to save merge resolution: ${err}`);
    }
  }, [filePath, onClose, onSave]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#0e0f14]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <span className="text-sm text-on-surface-variant/60">Loading conflicted file...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex flex-col min-h-0 overflow-hidden bg-background text-foreground"
      style={{ background: "var(--surface-container-low, #12131a)" }}
    >
      {/* Top Header Controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/[0.06] select-none shrink-0">
        <div className="flex items-center gap-3">
          <PathBreadcrumb filePath={filePath} />
          {conflictCount > 0 ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-xs border border-red-500/20">
              <AlertCircle size={12} />
              <span>{conflictCount} conflict(s) remaining</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs border border-emerald-500/20">
              <Check size={12} />
              <span>Conflicts resolved! Ready to merge.</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={<X size={14} />} onClick={onClose}>
            Abort
          </Button>
          <Button variant="primary" size="sm" icon={<Check size={14} />} onClick={handleSaveResolution}>
            Complete Merge
          </Button>
        </div>
      </div>

      {/* Editor Views Pane Layout */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top half: side-by-side Ours vs Theirs */}
        <div className="flex-1 flex min-h-0 border-b border-white/[0.06]">
          {/* Ours (Left) */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-white/[0.06]">
            <div className="px-3 py-1 bg-white/[0.01] border-b border-white/[0.04] text-[10px] uppercase font-mono tracking-wider text-blue-400 select-none">
              Current Changes (Ours)
            </div>
            <div ref={mountOursRef} className="flex-1 min-h-0 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto" />
          </div>

          {/* Theirs (Right) */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-1 bg-white/[0.01] border-b border-white/[0.04] text-[10px] uppercase font-mono tracking-wider text-purple-400 select-none">
              Incoming Changes (Theirs)
            </div>
            <div ref={mountTheirsRef} className="flex-1 min-h-0 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto" />
          </div>
        </div>

        {/* Bottom half: Result Editor */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-1 bg-white/[0.01] border-b border-white/[0.04] text-[10px] uppercase font-mono tracking-wider text-emerald-400 select-none">
            Result / Merged Output
          </div>
          <div ref={mountResultRef} className="flex-1 min-h-0 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto" />
        </div>
      </div>
    </div>
  );
}
