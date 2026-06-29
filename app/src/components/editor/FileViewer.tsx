import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { Compartment } from "@codemirror/state";
import { system } from "../../lib/ipc";
import { getLanguageExtension } from "../../lib/codeLang";
import { isImageFile } from "../../lib/fileUtils";
import { AlertCircle, Loader, Maximize2, Minimize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useSessionStore } from "../../stores/useSessionStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { closeAllPopups } from "../../lib/popups";
import { getEditorTheme, createThemeCompartment } from "./editorThemes";
import { createMinimapExtension, toggleMinimap } from "./minimapExtension";
import { SearchPanel } from "./SearchPanel";
import { usePTY } from "../../hooks/usePTY";
import { getDefaultShellLaunch } from "../../lib/shell";
import { useAppShellStore } from "../../stores/useAppShellStore";

const STYLE_ID = "aurora-file-viewer-style";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .cm-panel.cm-search { display: none !important; }
    .cm-tooltip-autocomplete { background: rgba(15,18,25,0.92) !important; border: 1px solid rgba(232,234,240,0.1) !important; border-radius: 8px !important; backdrop-filter: blur(16px) !important; padding: 4px !important; }
    .cm-tooltip-autocomplete ul { font-family: inherit !important; }
    .cm-tooltip-autocomplete li { padding: 4px 8px !important; border-radius: 4px !important; }
    .cm-tooltip-autocomplete li[aria-selected] { background: rgba(79,140,255,0.15) !important; }
    .cm-completionLabel { font-size: 12px !important; color: rgba(232,234,240,0.85) !important; }
    .cm-completionIcon { font-size: 11px !important; width: 1.2em !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }
    .cm-completionDetail { font-size: 10px !important; color: rgba(232,234,240,0.35) !important; margin-left: auto !important; padding-left: 12px !important; }
    .cm-completionMatchedText { text-decoration: none !important; color: rgba(79,140,255,0.9) !important; }
  `;
  document.head.appendChild(s);
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
  const initialContentRef = useRef<string>("");
  const updateTab = useSessionStore((s) => s.updateTab);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const { spawnSession } = usePTY();

  const isImage = isImageFile(filePath);
  const [showSearch, setShowSearch] = useState(false);
  const toggleSearchRef = useRef(() => setShowSearch(s => !s));
  const showMinimap = useSettingsStore((s) => s.showMinimap);
  const setShowMinimap = useSettingsStore((s) => s.setShowMinimap);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const [editorZoom, setEditorZoom] = useState(13);
  const wordWrapCompartmentRef = useRef<Compartment | null>(null);
  const zoomCompartmentRef = useRef<Compartment | null>(null);


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

  const handleGoToDefinition = () => {
    if (viewRef.current) {
      const sel = viewRef.current.state.selection.main;
      const word = viewRef.current.state.wordAt(sel.head);
      if (word) {
        const text = viewRef.current.state.sliceDoc(word.from, word.to);
        console.log(`LSP: Go to Definition for "${text}"`);
        window.dispatchEvent(new CustomEvent("focus-search-bar"));
      }
    }
  };

  const handlePeekDefinition = () => {
    if (viewRef.current) {
      const sel = viewRef.current.state.selection.main;
      const word = viewRef.current.state.wordAt(sel.head);
      if (word) {
        const text = viewRef.current.state.sliceDoc(word.from, word.to);
        console.log(`LSP: Peek Definition for "${text}"`);
      }
    }
  };

  const handleFindReferences = () => {
    if (viewRef.current) {
      const sel = viewRef.current.state.selection.main;
      const word = viewRef.current.state.wordAt(sel.head);
      if (word) {
        const text = viewRef.current.state.sliceDoc(word.from, word.to);
        console.log(`LSP: Find References for "${text}"`);
      }
    }
  };

  const handleRenameSymbol = () => {
    if (viewRef.current) {
      const sel = viewRef.current.state.selection.main;
      const word = viewRef.current.state.wordAt(sel.head);
      if (word) {
        const text = viewRef.current.state.sliceDoc(word.from, word.to);
        const newName = prompt(`Rename symbol "${text}" to:`, text);
        if (newName && newName !== text) {
          const fullText = viewRef.current.state.doc.toString();
          const replaced = fullText.split(text).join(newName);
          viewRef.current.dispatch({
            changes: { from: 0, to: viewRef.current.state.doc.length, insert: replaced }
          });
        }
      }
    }
  };

  const handleFormatDocument = () => {
    if (viewRef.current) {
      const text = viewRef.current.state.doc.toString();
      let formatted = text;
      try {
        if (filePath.endsWith(".json")) {
          formatted = JSON.stringify(JSON.parse(text), null, 2);
        } else {
          formatted = text.split("\n").map(line => line.trimEnd()).join("\n");
        }
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

        const [
          { EditorView, keymap, lineNumbers },
          { EditorState, Prec, Compartment },
          { autocompletion, completeAnyWord },
          { basicSetup },
          content,
          languageExt,
        ] = await Promise.all([
          import("@codemirror/view"),
          import("@codemirror/state"),
          import("@codemirror/autocomplete"),
          import("codemirror"),
          system.readFileContent(filePath),
          getLanguageExtension(filePath),
        ]);
        if (cancelled || !editorRef.current) { setLoading(false); return; }

        if (!wordWrapCompartmentRef.current) {
          wordWrapCompartmentRef.current = new Compartment();
        }
        if (!zoomCompartmentRef.current) {
          zoomCompartmentRef.current = new Compartment();
        }

        initialContentRef.current = content.replace(/\r\n/g, "\n");

        const extensions: any[] = [
          basicSetup,
          autocompletion({ activateOnTyping: true, maxRenderedOptions: 12 }),
          EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
          Prec.high(keymap.of([
            { key: "Mod-c", run: (view) => {
              if (!view.state.selection.main.empty) return false;
              const line = view.state.doc.lineAt(view.state.selection.main.head);
              navigator.clipboard.writeText(line.text + "\n");
              return true;
            }},
            { key: "Mod-x", run: (view) => {
              if (!view.state.selection.main.empty) return false;
              const line = view.state.doc.lineAt(view.state.selection.main.head);
              navigator.clipboard.writeText(line.text + "\n");
              view.dispatch({
                changes: { from: line.from, to: line.to },
                selection: { anchor: line.from },
              });
              return true;
            }},
            { key: "Mod-f", run: () => { toggleSearchRef.current?.(); return true; } },
            { key: "Mod-g", run: () => { toggleSearchRef.current?.(); return true; } },
            { key: "Shift-Mod-g", run: () => { toggleSearchRef.current?.(); return true; } },
            { key: "F3", run: () => { toggleSearchRef.current?.(); return true; } },
            { key: "Shift-F3", run: () => { toggleSearchRef.current?.(); return true; } },
            { key: "Mod-s", run: () => { handleSaveActiveFile(); return true; } },
            { key: "F12", run: () => { handleGoToDefinition(); return true; } },
            { key: "Alt-F12", run: () => { handlePeekDefinition(); return true; } },
            { key: "Shift-F12", run: () => { handleFindReferences(); return true; } },
            { key: "F2", run: () => { handleRenameSymbol(); return true; } },
            { key: "Shift-Mod-i", run: () => { handleFormatDocument(); return true; } },
            { key: "Mod-F5", run: () => { handleRunFile(); return true; } },
            { key: "Mod-=", run: () => { setEditorZoom((z) => Math.min(40, z + 1)); return true; } },
            { key: "Mod-+", run: () => { setEditorZoom((z) => Math.min(40, z + 1)); return true; } },
            { key: "Mod--", run: () => { setEditorZoom((z) => Math.max(8, z - 1)); return true; } },
          ])),
          themeCompartmentRef.current.of([]),
          wordWrapCompartmentRef.current!.of(wordWrap ? EditorView.lineWrapping : []),
          zoomCompartmentRef.current!.of(EditorView.theme({
            ".cm-content": { fontSize: `${editorZoom}px` },
            ".cm-gutters": { fontSize: `${editorZoom}px` },
            ".cm-scroller": { fontSize: `${editorZoom}px` }
          })),
          lineNumbers(),
          createMinimapExtension(showMinimap),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const currentContent = update.state.doc.toString();
              const isDirty = currentContent !== initialContentRef.current;
              updateTab(tabId, { dirty: isDirty, fileContent: currentContent, everChanged: true });
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

        getEditorTheme(editorTheme).then(theme => {
          if (viewRef.current === view) {
            view.dispatch({ effects: themeCompartmentRef.current.reconfigure(theme) });
          }
        });

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
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      updateTab(tabId, { dirty: false });
    };
  }, [filePath, tabId, updateTab, isImage, imageMimeType]);

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
      if (viewRef.current) {
        const sel = viewRef.current.state.selection.main;
        const word = viewRef.current.state.wordAt(sel.head);
        if (word) {
          const text = viewRef.current.state.sliceDoc(word.from, word.to);
          console.log(`LSP: Go to Definition for "${text}"`);
          window.dispatchEvent(new CustomEvent("focus-search-bar"));
        }
      }
    };
    const handlePeekDefinition = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) {
        const sel = viewRef.current.state.selection.main;
        const word = viewRef.current.state.wordAt(sel.head);
        if (word) {
          const text = viewRef.current.state.sliceDoc(word.from, word.to);
          console.log(`LSP: Peek Definition for "${text}"`);
        }
      }
    };
    const handleFindReferences = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) {
        const sel = viewRef.current.state.selection.main;
        const word = viewRef.current.state.wordAt(sel.head);
        if (word) {
          const text = viewRef.current.state.sliceDoc(word.from, word.to);
          console.log(`LSP: Find References for "${text}"`);
        }
      }
    };
    const handleRenameSymbol = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) {
        const sel = viewRef.current.state.selection.main;
        const word = viewRef.current.state.wordAt(sel.head);
        if (word) {
          const text = viewRef.current.state.sliceDoc(word.from, word.to);
          const newName = prompt(`Rename symbol "${text}" to:`, text);
          if (newName && newName !== text) {
            const fullText = viewRef.current.state.doc.toString();
            const replaced = fullText.split(text).join(newName);
            viewRef.current.dispatch({
              changes: { from: 0, to: viewRef.current.state.doc.length, insert: replaced }
            });
          }
        }
      }
    };
    const handleFormatDocument = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tabId !== tabId) return;
      if (viewRef.current) {
        const text = viewRef.current.state.doc.toString();
        let formatted = text;
        try {
          if (filePath.endsWith(".json")) {
            formatted = JSON.stringify(JSON.parse(text), null, 2);
          } else {
            formatted = text.split("\n").map(line => line.trimEnd()).join("\n");
          }
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
    window.addEventListener("file-format-document", handleFormatDocument);
    window.addEventListener("file-run", handleRunFile);
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
      window.removeEventListener("file-format-document", handleFormatDocument);
      window.removeEventListener("file-run", handleRunFile);
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
          <>
            <div
              ref={editorRef}
              className="h-full w-full overflow-hidden [&_.cm-editor]:h-full"
            />
            {showSearch && viewRef.current && (
              <SearchPanel
                view={viewRef.current}
                onClose={() => setShowSearch(false)}
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
