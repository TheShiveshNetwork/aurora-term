import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, tooltips } from "@codemirror/view";
import { EditorState, Prec, Compartment } from "@codemirror/state";
import { autocompletion, completeAnyWord, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap } from "@codemirror/language";
import { highlightSelectionMatches, selectSelectionMatches } from "@codemirror/search";
import { lintGutter, linter, lintKeymap } from "@codemirror/lint";
import { listen } from "@tauri-apps/api/event";
import { system, ai } from "../../lib/ipc";
import { getLanguageExtension } from "../../lib/codeLang";
import { isImageFile } from "../../lib/fileUtils";
import { AlertCircle, Loader, Maximize2, Minimize2, Minus, Plus, RotateCw, GitMerge } from "lucide-react";
import { useSessionStore } from "../../stores/useSessionStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { closeAllPopups } from "../../lib/popups";
import { getEditorTheme, createThemeCompartment } from "./editorThemes";
import { createMinimapExtension, toggleMinimap } from "./minimapExtension";
import { getLinterSource } from "./linterSources";
import { inlineCompletion } from "./aiExtensions";
import { mergeConflictResolver } from "./mergeConflictExtension";
import { SearchPanel } from "./SearchPanel";
import { indentMarkersExtension } from "./indentMarkersExtension";
import { usePTY } from "../../hooks/usePTY";
import { getDefaultShellLaunch } from "../../lib/shell";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { languageIdFromPath } from "../../extensions/lsp/languageId";
import {
  connectLanguage,
  gotoDefinitionAt,
  peekDefinition,
  lspRenameSymbol,
  lspFindReferences,
  lspFormatDocument,
  lspCodeAction,
  lspOrganizeImports,
  type PeekResult,
} from "../../extensions/lsp/client";
import { centerFindNext, centerFindPrevious } from "../../lib/editorScroll";
import { openFileInApp } from "../../lib/openFileRef";
import { PeekPanel } from "./PeekPanel";
import { toStr } from "../../stores/useToastStore";
import { notify } from "../../lib/notify";

// Languages whose "ready" success toast has already been shown this session,
// so we don't re-toast on every subsequent file open.
const lspReadyNotified = new Set<string>();

const STYLE_ID = "aurora-file-viewer-style";
if (typeof document !== "undefined") {
  let s = document.getElementById(STYLE_ID) as HTMLStyleElement;
  if (!s) {
    s = document.createElement("style");
    s.id = STYLE_ID;
    document.head.appendChild(s);
  }
  s.textContent = `
    :root { --editor-font-size: 13px; }

    /* Hide the built-in find panel (we render our own SearchPanel). */
    .cm-panel.cm-search { display: none !important; }

    /* Colors, borders and backgrounds of the LSP/lint UI are left entirely to the
       active CodeMirror theme (which themes tooltips, panels and the
       autocomplete to match the editor). We only bind the font size to the
       editor's actual text size so the LSP/lint UI scales with it. */
    .cm-tooltip,
    .cm-lsp-hover-tooltip,
    .cm-lsp-documentation,
    .cm-lsp-signature-tooltip,
    .cm-diagnostic,
    .cm-diagnosticSource,
    .cm-diagnosticAction,
    .cm-lsp-rename-panel,
    .cm-lsp-reference-panel,
    .cm-lsp-reference,
    .cm-lsp-message,
    .cm-panel-lint,
    .cm-code-action-menu {
      font-size: var(--editor-font-size, 13px) !important;
    }

    /* Structural size constraints only (no color/theme overrides) so tooltips
       and panels never overflow the editor viewport, including very long lines
       in hover docs. */
    .cm-lsp-hover-tooltip, .cm-lsp-documentation {
      max-width: min(640px, var(--editor-tooltip-maxw, 92vw));
      max-height: var(--editor-tooltip-maxh, 52vh);
      overflow: auto;
    }
    .cm-lsp-signature-tooltip {
      max-width: min(640px, var(--editor-tooltip-maxw, 92vw));
      max-height: var(--editor-tooltip-maxh, 40vh);
      overflow: auto;
    }
    .cm-lsp-rename-panel, .cm-lsp-reference-panel, .cm-panel-lint {
      max-width: min(560px, var(--editor-tooltip-maxw, 92vw));
      max-height: var(--editor-tooltip-maxh, 52vh);
      overflow: auto;
    }
    .cm-tooltip-autocomplete {
      max-width: var(--editor-tooltip-maxw, 92vw);
      max-height: var(--editor-tooltip-maxh, 50vh);
      overflow-y: auto;
    }
    .cm-code-action-menu {
      max-width: min(320px, 92vw);
    }

    /* The code-action menu is rendered outside the editor DOM (appended to
       <body>), so it cannot inherit CodeMirror's theme. Give it the app's
       surface tokens so it still matches the surrounding chrome. */
    .cm-code-action-menu {
      background: var(--color-ui-surface, rgba(19,26,36,0.95));
      border: 1px solid var(--color-ui-border, rgba(255,255,255,0.08));
      border-radius: var(--radius-md, 14px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
      padding: 4px;
      min-width: 220px;
      color: var(--color-on-surface, #E8EAF0);
      backdrop-filter: blur(18px) saturate(140%);
      -webkit-backdrop-filter: blur(18px) saturate(140%);
    }
    .cm-code-action-item {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      border: none;
      color: inherit;
      padding: 6px 10px;
      border-radius: var(--radius-sm, 10px);
      cursor: pointer;
      font: inherit;
      transition: background .12s ease;
    }
    .cm-code-action-item:hover { background: var(--color-primary-container, rgba(79,140,255,0.15)); }
  `;
}

interface FileViewerProps {
  tabId: string;
  filePath: string;
  fileName: string;
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;
const ZOOM_STEP = 0.25;

export function FileViewer({ tabId, filePath, fileName }: FileViewerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef<Compartment>(createThemeCompartment());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasConflicts, setHasConflicts] = useState(false);
  const initialContentRef = useRef<string>("");
  const updateTab = useSessionStore((s) => s.updateTab);
  const tab = useSessionStore(s => s.tabs.find(t => t.id === tabId));
  const isMissing = tab?.missing ?? false;
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const { spawnSession } = usePTY();

  const isImage = isImageFile(filePath);
  const [showSearch, setShowSearch] = useState(false);
  const [initialFindText, setInitialFindText] = useState("");
  const toggleSearchRef = useRef(() => {
    const sel = viewRef.current?.state.selection.main;
    const text = sel && !sel.empty ? viewRef.current!.state.sliceDoc(sel.from, sel.to) : "";
    setInitialFindText(text);
    setShowSearch(s => !s);
  });
  const showMinimap = useSettingsStore((s) => s.showMinimap);
  const setShowMinimap = useSettingsStore((s) => s.setShowMinimap);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const aiLiveSuggestions = useSettingsStore((s) => s.aiLiveSuggestions);
  const indentMarkers = useSettingsStore((s) => s.indentMarkers);
  const lspEnabled = useSettingsStore((s) => s.lspEnabled);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const [editorZoom, setEditorZoom] = useState(editorFontSize);
  const wordWrapCompartmentRef = useRef<Compartment | null>(null);
  const zoomCompartmentRef = useRef<Compartment | null>(null);
  const indentMarkersCompartmentRef = useRef<Compartment | null>(null);
  const searchPanelCompartmentRef = useRef<Compartment | null>(null);
  const lspCompartmentRef = useRef<Compartment | null>(null);
  const [peek, setPeek] = useState<PeekResult | null>(null);
  const contextPosRef = useRef<number | null>(null);


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

  const handleSaveActiveFile = async () => {
    if (viewRef.current) {
      const content = viewRef.current.state.doc.toString();
      try {
        await system.writeFileContent(filePath, content);
        initialContentRef.current = content.replace(/\r\n/g, "\n");
        updateTab(tabId, { dirty: false, fileContent: content });
      } catch (err) {
        console.error("Failed to save file:", err);
      }
    }
  };

  const formatContent = (text: string, fp: string): string => {
    if (fp.endsWith(".json")) {
      return JSON.stringify(JSON.parse(text), null, 2);
    }
    if (fp.endsWith(".html") || fp.endsWith(".htm") || fp.endsWith(".xml") || fp.endsWith(".svg")) {
      let depth = 0;
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const out: string[] = [];
      for (const l of lines) {
        const closes = l.startsWith("</") || l.match(/\/>\s*$/);
        if (closes) depth = Math.max(0, depth - 1);
        out.push("  ".repeat(depth) + l);
        if (!closes && !l.endsWith("/>") && l.includes("<") && !l.includes("</")) depth++;
      }
      return out.join("\n");
    }
    return text.split("\n").map(line => line.trimEnd()).join("\n");
  };

  const handleFormatDocument = () => {
    if (viewRef.current) {
      try {
        const formatted = formatContent(viewRef.current.state.doc.toString(), filePath);
        viewRef.current.dispatch({
          changes: { from: 0, to: viewRef.current.state.doc.length, insert: formatted }
        });
      } catch (err) {
        console.error("Format error:", err);
      }
    }
  };

  const handleRunFile = () => {
    let command = "";
    if (filePath.endsWith(".py")) {
      command = `python "${filePath}"`;
    } else if (filePath.endsWith(".js")) {
      command = `node "${filePath}"`;
    } else if (filePath.endsWith(".ts")) {
      command = `ts-node "${filePath}"`;
    } else if (filePath.endsWith(".rs")) {
      command = `cargo run`;
    } else if (filePath.endsWith(".sh")) {
      command = `bash "${filePath}"`;
    } else if (filePath.endsWith(".bat") || filePath.endsWith(".ps1")) {
      command = `powershell "${filePath}"`;
    } else {
      command = `echo "Cannot run file type of ${filePath}"`;
    }

    const { shell, args } = getDefaultShellLaunch();
    const appShellStore = useAppShellStore.getState();
    const spawnCwd = appShellStore.projectDir || appShellStore.cwdAbsolute;
    spawnSession(shell, args, {}, spawnCwd).then((sessionId) => {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(`pty-command-run:${sessionId}`, { detail: { cmd: command } }));
      }, 200);
    }).catch(console.error);
  };

  useEffect(() => {
    let cancelled = false;
    let tooltipResizeObserver: ResizeObserver | null = null;

    const loadFile = async () => {
      try {
        setLoading(true);
        setError(null);

        if (isImage) {
          const b64 = await system.readFileBase64(filePath);
          if (cancelled) return;
          setImageSrc(`data:${imageMimeType};base64,${b64}`);
          setLoading(false);
          return;
        }

        if (!editorRef.current) { setLoading(false); return; }

        const ext = filePath.split(".").pop()?.toLowerCase() || "";
        const [
          content,
          languageExt,
          lintSource,
        ] = await Promise.all([
          system.readFileContent(filePath),
          getLanguageExtension(filePath),
          getLinterSource(ext),
        ]);
        if (cancelled || !editorRef.current) { setLoading(false); return; }

        const hasMergeMarkers = /^<<<<<<< .+/m.test(content) && /^>>>>>>> .+/m.test(content);
        setHasConflicts(hasMergeMarkers);

        if (!wordWrapCompartmentRef.current) {
          wordWrapCompartmentRef.current = new Compartment();
        }
        if (!zoomCompartmentRef.current) {
          zoomCompartmentRef.current = new Compartment();
        }
        if (!indentMarkersCompartmentRef.current) {
          indentMarkersCompartmentRef.current = new Compartment();
        }

        if (!searchPanelCompartmentRef.current) {
          searchPanelCompartmentRef.current = new Compartment();
        }

        if (!lspCompartmentRef.current) {
          lspCompartmentRef.current = new Compartment();
        }

        // Determine whether to bring up an LSP server for this file. When an
        // LSP is active for the language we suppress the lighter built-in
        // Lezer linter (the LSP supersedes it) to avoid duplicate diagnostics.
        const languageId = isImage ? null : languageIdFromPath(filePath);
        const useLsp = !!languageId && lspEnabled;

        initialContentRef.current = content.replace(/\r\n/g, "\n");

        const extensions: any[] = [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          EditorView.clickAddsSelectionRange.of((event) => event.altKey),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          // Keep tooltips (hover, completions, diagnostics) inside the editor's
          // own bounds instead of the whole window. By default CodeMirror uses
          // the window as the "tooltip space", which lets the LSP hover spill
          // under the right side panel when a token is near the editor's right
          // edge. Returning the editor's rect confines it to the safe area.
          tooltips({
            tooltipSpace: (view) => {
              const rect = view.dom.getBoundingClientRect();
              return { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
            },
          }),
          autocompletion({ activateOnTyping: true, maxRenderedOptions: 12 }),
          EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          lintGutter(),
          ...(useLsp ? [] : lintSource ? [linter(lintSource)] : []),
          keymap.of(lintKeymap),
          ...(aiLiveSuggestions ? [
            ...inlineCompletion({
              fetchFn: async (state, _signal, _view) => {
                const cursorPos = state.selection.main.head;
                const contextBefore = state.sliceDoc(0, cursorPos);
                if (!contextBefore.trim()) return "";
                const ext = filePath.split(".").pop() || "";
                const result = await ai.inlineComplete(contextBefore, ext);
                return result.completion ?? "";
              },
              delay: 600,
            }),
          ] : []),
          ...(/^<<<<<<< .+/m.test(content) && /^>>>>>>> .+/m.test(content)
            ? mergeConflictResolver()
            : []),
          themeCompartmentRef.current.of([]),
          wordWrapCompartmentRef.current!.of(wordWrap ? EditorView.lineWrapping : []),
          zoomCompartmentRef.current!.of(EditorView.theme({
            ".cm-content": { fontSize: `${editorZoom}px` },
            ".cm-gutters": { fontSize: `${editorZoom}px` },
            ".cm-scroller": { fontSize: `${editorZoom}px` }
          })),
          createMinimapExtension(showMinimap),
          indentMarkersCompartmentRef.current.of(indentMarkers ? indentMarkersExtension() : []),
          searchPanelCompartmentRef.current.of([]),
          lspCompartmentRef.current.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const currentContent = update.state.doc.toString();
              const isDirty = currentContent !== initialContentRef.current;
              updateTab(tabId, { dirty: isDirty, fileContent: currentContent, everChanged: true });
              setHasConflicts(/^<<<<<<< .+/m.test(currentContent) && /^>>>>>>> .+/m.test(currentContent));
            }
            if (update.selectionSet) {
              const sel = update.state.selection.main;
              if (!sel.empty) {
                const fromLine = update.state.doc.lineAt(sel.from).number;
                const toLine = update.state.doc.lineAt(sel.to).number;
                const text = update.state.sliceDoc(sel.from, sel.to);
                updateTab(tabId, { selection: { startLine: fromLine, endLine: toLine, text } });
              } else {
                updateTab(tabId, { selection: null });
              }
            }
          }),
        ];

        if (languageExt.length > 0) {
          extensions.push(...languageExt);
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

        // Cap LSP/lint tooltips to the editor's actual box (not the viewport)
        // so a wide/tall hover never spills under the right side panel or below
        // the view. `tooltipSpace` confines placement; these bounds guarantee
        // the placement math can never push the tooltip past the editor edges.
        const updateTooltipBounds = () => {
          const w = Math.max(220, view.dom.clientWidth - 24);
          const h = Math.max(160, view.dom.clientHeight - 16);
          view.dom.style.setProperty("--editor-tooltip-maxw", `${w}px`);
          view.dom.style.setProperty("--editor-tooltip-maxh", `${h}px`);
        };
        updateTooltipBounds();
        tooltipResizeObserver = new ResizeObserver(updateTooltipBounds);
        tooltipResizeObserver.observe(view.dom);

        if (tab?.scrollToLine !== undefined) {
          try {
            const lineNum = Math.min(Math.max(1, tab.scrollToLine), view.state.doc.lines);
            const lineInfo = view.state.doc.line(lineNum);
            const mStart = tab.scrollToMatchStart ?? 0;
            const mEnd = tab.scrollToMatchEnd ?? 0;
            const startPos = Math.min(lineInfo.from + mStart, lineInfo.to);
            const endPos = Math.min(lineInfo.from + mEnd, lineInfo.to);

            view.dispatch({
              selection: { anchor: startPos, head: endPos },
              effects: EditorView.scrollIntoView(startPos, { y: "center", yMargin: 48 })
            });
            view.focus();

            updateTab(tabId, {
              scrollToLine: undefined,
              scrollToMatchStart: undefined,
              scrollToMatchEnd: undefined,
            });
          } catch (err) {
            console.error("Initial scroll to line failed:", err);
          }
        }

        getEditorTheme(editorTheme).then(theme => {
          if (viewRef.current === view) {
            view.dispatch({ effects: themeCompartmentRef.current.reconfigure(theme) });
          }
        });

        // Bring up the language server for this file (downloads on first use,
        // then pipes LSP diagnostics/completions/hover into the editor). Runs
        // after the view exists so we can attach the client plugin. The setup
        // is surfaced through a generic async notification (loading → done).
        if (useLsp && languageId) {
          const label = languageId.charAt(0).toUpperCase() + languageId.slice(1);
          const root = useAppShellStore.getState().projectDir || null;

          notify(
            {
              loadingTitle: `Setting up ${label} language server`,
              loadingMessage: `Setting up the ${label} language server…`,
              onSuccess: () => {
                if (cancelled) return;
                if (!lspReadyNotified.has(languageId)) {
                  lspReadyNotified.add(languageId);
                  notify(`${label} language server ready`, "success", 3000);
                }
              },
              onError: (err) => {
                if (cancelled) return;
                notify(`LSP unavailable for ${label}: ${toStr(err)}`, "error", 8000);
              },
            },
            () =>
              connectLanguage(languageId, filePath, root).then((ext) => {
                if (!cancelled && viewRef.current === view && lspCompartmentRef.current) {
                  viewRef.current.dispatch({
                    effects: lspCompartmentRef.current.reconfigure(ext),
                  });
                }
                return ext;
              }),
          );
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load file:", err);
          setError(String(err) || "Failed to load file");
          setLoading(false);
        }
      }
    };

    loadFile();

    return () => {
      cancelled = true;
      if (tooltipResizeObserver) {
        tooltipResizeObserver.disconnect();
        tooltipResizeObserver = null;
      }
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      updateTab(tabId, { dirty: false });
    };
  }, [filePath, tabId, updateTab, isImage, imageMimeType, aiLiveSuggestions]);

  // Separate useEffect to handle scrolling to a line on tab selection/navigation
  useEffect(() => {
    const view = viewRef.current;
    if (view && tab?.scrollToLine !== undefined) {
      try {
        const lineNum = Math.min(Math.max(1, tab.scrollToLine), view.state.doc.lines);
        const lineInfo = view.state.doc.line(lineNum);
        const mStart = tab.scrollToMatchStart ?? 0;
        const mEnd = tab.scrollToMatchEnd ?? 0;
        const startPos = Math.min(lineInfo.from + mStart, lineInfo.to);
        const endPos = Math.min(lineInfo.from + mEnd, lineInfo.to);

        view.dispatch({
          selection: { anchor: startPos, head: endPos },
          effects: EditorView.scrollIntoView(startPos, { y: "center", yMargin: 48 })
        });
        view.focus();

        updateTab(tabId, {
          scrollToLine: undefined,
          scrollToMatchStart: undefined,
          scrollToMatchEnd: undefined,
        });
      } catch (err) {
        console.error("Runtime scroll to line failed:", err);
      }
    }
  }, [tab?.scrollToLine, tab?.scrollToMatchStart, tab?.scrollToMatchEnd, tabId, updateTab]);

  // Esc dismisses an open definition peek without navigating.
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPeek(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek]);

  // Reload file content when external changes are detected (git checkout, external editor, etc.)
  useEffect(() => {
    let unlistenContent: (() => void) | null = null;
    let unlistenDeleted: (() => void) | null = null;
    listen<string>("file-content-changed", async (event) => {
      if (event.payload !== filePath) return;
      const view = viewRef.current;
      if (!view) return;
      // Only reload if the file has no unsaved changes
      const currentContent = view.state.doc.toString();
      if (currentContent !== initialContentRef.current) return;
      try {
        const newContent = await system.readFileContent(filePath);
        const normalized = newContent.replace(/\r\n/g, "\n");
        if (normalized === initialContentRef.current) return;
        initialContentRef.current = normalized;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: normalized },
        });
        updateTab(tabId, { dirty: false, fileContent: normalized, missing: false });
      } catch { /* file may be temporarily unavailable */ }
    }).then((u) => { unlistenContent = u; });
    listen<string>("file-deleted", (event) => {
      if (event.payload !== filePath) return;
      updateTab(tabId, { missing: true });
    }).then((u) => { unlistenDeleted = u; });
    return () => { unlistenContent?.(); unlistenDeleted?.(); };
  }, [filePath, tabId, updateTab]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    getEditorTheme(editorTheme).then(theme => {
      if (viewRef.current !== view) return;
      view.dispatch({ effects: themeCompartmentRef.current.reconfigure(theme) });
    });
  }, [editorTheme]);

  useEffect(() => {
    const handler = () => {
      if (viewRef.current) {
        viewRef.current.dispatch({ selection: { anchor: 0, head: viewRef.current.state.doc.length } });
      }
    };
    const handlePaste = (e: Event) => {
      const text = (e as CustomEvent).detail.text;
      if (viewRef.current && text) {
        const sel = viewRef.current.state.selection.main;
        viewRef.current.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
        });
        viewRef.current.focus();
      }
    };
    const handleCopyLine = () => {
      if (viewRef.current) {
        const sel = viewRef.current.state.selection.main;
        const line = viewRef.current.state.doc.lineAt(sel.head);
        navigator.clipboard.writeText(line.text + "\n");
      }
    };
    const handleCutLine = () => {
      if (viewRef.current) {
        const sel = viewRef.current.state.selection.main;
        const line = viewRef.current.state.doc.lineAt(sel.head);
        navigator.clipboard.writeText(line.text + "\n");
        viewRef.current.dispatch({
          changes: { from: line.from, to: line.to },
          selection: { anchor: line.from },
        });
        viewRef.current.focus();
      }
    };
    const handleCutSelection = (e: Event) => {
      const text = (e as CustomEvent).detail.text;
      if (viewRef.current && text) {
        const sel = viewRef.current.state.selection.main;
        viewRef.current.dispatch({
          changes: { from: sel.from, to: sel.to },
        });
      }
    };
    const handleSaveFile = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;

      if (viewRef.current) {
        const content = viewRef.current.state.doc.toString();
        try {
          await system.writeFileContent(filePath, content);
          initialContentRef.current = content.replace(/\r\n/g, "\n");
          updateTab(tabId, { dirty: false, fileContent: content });
        } catch (err) {
          console.error("Failed to save file:", err);
        }
      }
    };
    const handleGoToDefinition = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      const view = viewRef.current;
      if (!view) return;
      const pos = contextPosRef.current ?? view.state.selection.main.head;
      view.dispatch({ selection: { anchor: pos } });
      void gotoDefinitionAt(view);
    };
    const handlePeekDefinition = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      const view = viewRef.current;
      if (!view) return;
      const pos = contextPosRef.current ?? view.state.selection.main.head;
      view.dispatch({ selection: { anchor: pos } });
      const data = await peekDefinition(view);
      if (data) setPeek(data);
    };
    const handleRenameSymbol = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) lspRenameSymbol(viewRef.current);
    };
    const handleFindReferences = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) lspFindReferences(viewRef.current);
    };
    const handleChangeAllOccurrences = async () => {
      if (viewRef.current) {
        const view = viewRef.current;
        const sel = view.state.selection.main;
        const text = sel.empty
          ? (() => {
            const word = view.state.wordAt(sel.head);
            return word ? view.state.sliceDoc(word.from, word.to) : "";
          })()
          : view.state.sliceDoc(sel.from, sel.to);
        if (text) {
          const docLower = view.state.doc.toString().toLowerCase();
          const textLower = text.toLowerCase();
          const ranges: any[] = [];
          const { EditorSelection } = await import("@codemirror/state");

          let pos = 0;
          while (true) {
            const index = docLower.indexOf(textLower, pos);
            if (index === -1) break;
            ranges.push(EditorSelection.range(index, index + text.length));
            pos = index + textLower.length;
          }

          if (ranges.length > 0) {
            view.dispatch({
              selection: EditorSelection.create(ranges)
            });
            view.focus();
          }
        }
      }
    };
    const handleFormatDocumentEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) {
        if (lspFormatDocument(viewRef.current)) return;
        try {
          const formatted = formatContent(viewRef.current.state.doc.toString(), filePath);
          viewRef.current.dispatch({
            changes: { from: 0, to: viewRef.current.state.doc.length, insert: formatted }
          });
        } catch (err) {
          console.error("Format error:", err);
        }
      }
    };
    const handleRunFile = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      let command = "";
      if (filePath.endsWith(".py")) {
        command = `python "${filePath}"`;
      } else if (filePath.endsWith(".js")) {
        command = `node "${filePath}"`;
      } else if (filePath.endsWith(".ts")) {
        command = `ts-node "${filePath}"`;
      } else if (filePath.endsWith(".rs")) {
        command = `cargo run`;
      } else if (filePath.endsWith(".sh")) {
        command = `bash "${filePath}"`;
      } else if (filePath.endsWith(".bat") || filePath.endsWith(".ps1")) {
        command = `powershell "${filePath}"`;
      } else {
        command = `echo "Cannot run file type of ${filePath}"`;
      }

      const { shell, args } = getDefaultShellLaunch();
      const appShellStore = useAppShellStore.getState();
      const spawnCwd = appShellStore.projectDir || appShellStore.cwdAbsolute;
      spawnSession(shell, args, {}, spawnCwd).then((sessionId) => {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(`pty-command-run:${sessionId}`, { detail: { cmd: command } }));
        }, 200);
      }).catch(console.error);
    };

    const handleFind = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      toggleSearchRef.current?.();
    };
    const handleFindNext = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) centerFindNext(viewRef.current);
    };
    const handleFindPrev = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) centerFindPrevious(viewRef.current);
    };
    const handleZoomIn = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      setEditorZoom((z) => Math.min(40, z + 1));
    };
    const handleZoomOut = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      setEditorZoom((z) => Math.max(8, z - 1));
    };
    const handleSelectMatches = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) selectSelectionMatches(viewRef.current);
    };
    const handleCodeAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) lspCodeAction(viewRef.current);
    };
    const handleOrganizeImports = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) lspOrganizeImports(viewRef.current);
    };

    window.addEventListener("file-select-all", handler);
    window.addEventListener("file-paste", handlePaste);
    window.addEventListener("file-copy-line", handleCopyLine);
    window.addEventListener("file-cut-line", handleCutLine);
    window.addEventListener("file-cut-selection", handleCutSelection);
    window.addEventListener("file-save", handleSaveFile);
    window.addEventListener("file-go-to-definition", handleGoToDefinition);
    window.addEventListener("file-peek-definition", handlePeekDefinition);
    window.addEventListener("file-find-references", handleFindReferences);
    window.addEventListener("file-rename-symbol", handleRenameSymbol);
    window.addEventListener("file-change-all-occurrences", handleChangeAllOccurrences);
    window.addEventListener("file-format-document", handleFormatDocumentEvent);
    window.addEventListener("file-run", handleRunFile);
    window.addEventListener("file-find", handleFind);
    window.addEventListener("file-find-next", handleFindNext);
    window.addEventListener("file-find-prev", handleFindPrev);
    window.addEventListener("file-zoom-in", handleZoomIn);
    window.addEventListener("file-zoom-out", handleZoomOut);
    window.addEventListener("file-select-matches", handleSelectMatches);
    window.addEventListener("file-code-action", handleCodeAction);
    window.addEventListener("file-organize-imports", handleOrganizeImports);
    return () => {
      window.removeEventListener("file-select-all", handler);
      window.removeEventListener("file-paste", handlePaste);
      window.removeEventListener("file-cut-line", handleCutLine);
      window.removeEventListener("file-copy-line", handleCopyLine);
      window.removeEventListener("file-cut-selection", handleCutSelection);
      window.removeEventListener("file-save", handleSaveFile);
      window.removeEventListener("file-go-to-definition", handleGoToDefinition);
      window.removeEventListener("file-peek-definition", handlePeekDefinition);
      window.removeEventListener("file-find-references", handleFindReferences);
      window.removeEventListener("file-rename-symbol", handleRenameSymbol);
      window.removeEventListener("file-change-all-occurrences", handleChangeAllOccurrences);
      window.removeEventListener("file-format-document", handleFormatDocumentEvent);
      window.removeEventListener("file-run", handleRunFile);
      window.removeEventListener("file-find", handleFind);
      window.removeEventListener("file-find-next", handleFindNext);
      window.removeEventListener("file-find-prev", handleFindPrev);
      window.removeEventListener("file-zoom-in", handleZoomIn);
      window.removeEventListener("file-zoom-out", handleZoomOut);
      window.removeEventListener("file-select-matches", handleSelectMatches);
      window.removeEventListener("file-code-action", handleCodeAction);
      window.removeEventListener("file-organize-imports", handleOrganizeImports);
    };
  }, [tabId, filePath, updateTab]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const tr = toggleMinimap(view.state, showMinimap);
    view.dispatch(tr);
  }, [showMinimap]);

  // React to wordWrap change
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !wordWrapCompartmentRef.current) return;
    import("@codemirror/view").then(({ EditorView }) => {
      if (viewRef.current === view) {
        view.dispatch({
          effects: wordWrapCompartmentRef.current!.reconfigure(wordWrap ? EditorView.lineWrapping : [])
        });
      }
    });
  }, [wordWrap]);

  // React to indentMarkers toggle
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !indentMarkersCompartmentRef.current) return;
    view.dispatch({
      effects: indentMarkersCompartmentRef.current.reconfigure(
        indentMarkers ? indentMarkersExtension() : []
      )
    });
  }, [indentMarkers]);

  // Keep the LSP/lint UI font size in sync with the editor's actual displayed
  // text size (editorZoom), so the hover/diagnostics/completion UI matches the
  // editor window instead of the unrelated terminal font-size setting.
  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${editorZoom}px`);
  }, [editorZoom]);

  // When the editor font-size setting changes, rebase the editor zoom (Ctrl+scroll
  // still adjusts editorZoom on top of this) so CodeMirror picks up the new size.
  useEffect(() => {
    setEditorZoom(editorFontSize);
  }, [editorFontSize]);

  // React to editorZoom change
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !zoomCompartmentRef.current) return;
    import("@codemirror/view").then(({ EditorView }) => {
      if (viewRef.current === view) {
        view.dispatch({
          effects: zoomCompartmentRef.current!.reconfigure(
            EditorView.theme({
              ".cm-content": { fontSize: `${editorZoom}px` },
              ".cm-gutters": { fontSize: `${editorZoom}px` },
              ".cm-scroller": { fontSize: `${editorZoom}px` },
            })
          )
        });
      }
    });
  }, [editorZoom]);

  // Mouse wheel zoom handler (Ctrl + Wheel)
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const handleWheel = (e: globalThis.WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          setEditorZoom((z) => Math.min(40, z + 1));
        } else {
          setEditorZoom((z) => Math.max(8, z - 1));
        }
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, [isImage]);

  // Store initial content ref so save functions can reset dirty after write
  // (fileContent is stored in the session store via updateListener above)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    contextPosRef.current = viewRef.current
      ? viewRef.current.posAtCoords({ x: e.clientX, y: e.clientY }) ?? null
      : null;

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
      {hasConflicts && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-200 select-none">
          <div className="flex items-center gap-2 text-xs">
            <AlertCircle size={14} className="text-amber-400" />
            <span>This file has git merge conflicts. Resolve them in the 3-Way Merge Editor for a better experience.</span>
          </div>
          <button
            onClick={() => useSessionStore.getState().updateTab(tabId, { type: "merge" })}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-black font-semibold text-xs transition-all duration-200 cursor-pointer shadow-sm"
          >
            <GitMerge size={12} />
            <span>Open Merge Editor</span>
          </button>
        </div>
      )}
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

        {isMissing && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low/80 z-20">
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <AlertCircle size={32} className="text-amber-400" />
              <span className="text-sm text-on-surface font-medium">File has been deleted</span>
              <span className="text-xs text-on-surface-variant">{filePath}</span>
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
                <RotateCw size={14} />
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
          <>
            <div
              ref={editorRef}
              className="h-full w-full overflow-hidden [&_.cm-editor]:h-full"
            />
            {showSearch && viewRef.current && (
              <SearchPanel
                view={viewRef.current}
                onClose={() => { setShowSearch(false); setInitialFindText(""); }}
                initialFindText={initialFindText}
                searchPanelCompartment={searchPanelCompartmentRef.current}
              />
            )}
            {peek && (
              <PeekPanel
                peek={peek}
                onClose={() => setPeek(null)}
                onNavigate={() => {
                  openFileInApp(peek.path, undefined, {
                    lineNumber: peek.targetRange.start.line + 1,
                    matchStart: peek.targetRange.start.character,
                    matchEnd: peek.targetRange.end.character,
                  });
                  setPeek(null);
                }}
              />
            )}
            <button
              onClick={() => setShowMinimap(!showMinimap)}
              className="absolute bottom-2 right-2 p-1 rounded transition-opacity hover:opacity-100 opacity-40 text-on-surface/50"
              title={showMinimap ? "Hide minimap" : "Show minimap"}
            >
              {showMinimap ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
