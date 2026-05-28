import { forwardRef, useEffect, useRef, useImperativeHandle } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { vim, Vim, CodeMirror } from "@replit/codemirror-vim";
import { defaultKeymap } from "@codemirror/commands";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { StreamLanguage } from "@codemirror/language";

export type EditorMode = "NORMAL" | "INSERT" | "VISUAL" | "COMMAND";

export interface InputBarHandle {
  focus: () => void;
  setValue: (val: string) => void;
  getValue: () => string;
}

interface InputBarProps {
  sessionId: string;
  history: string[];
  onSubmit: (command: string) => void;
  onModeChange?: (mode: EditorMode) => void;
}

// ── Beautiful Custom aurora-term editor theme extension ───────────────────
const auroraTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--color-term-fg, #e8e8e8)",
      fontSize: "13px",
      fontFamily: "var(--font-mono, monospace)",
    },
    ".cm-content": {
      caretColor: "var(--color-term-cursor, #f0c060)",
      fontFamily: "var(--font-mono, monospace)",
      padding: "0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--color-term-cursor, #f0c060)",
      borderWidth: "2px",
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-gutters": {
      display: "none",
    },
  },
  { dark: true }
);

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(
  ({ sessionId, history, onSubmit, onModeChange }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const historyIndexRef = useRef<number>(-1);
    const draftRef = useRef<string>("");

    // Expose methods to parent components (like focusing and setting values)
    useImperativeHandle(ref, () => ({
      focus: () => {
        viewRef.current?.focus();
      },
      setValue: (val: string) => {
        if (!viewRef.current) return;
        const currentLength = viewRef.current.state.doc.length;
        viewRef.current.dispatch({
          changes: { from: 0, to: currentLength, insert: val },
        });
      },
      getValue: () => {
        return viewRef.current?.state.doc.toString() || "";
      },
    }));

    useEffect(() => {
      if (!editorRef.current) return;

      const submitCmd = (view: EditorView) => {
        const command = view.state.doc.toString();
        if (!command.trim()) return true;

        onSubmit(command);
        
        // Reset document and history pointer after execution
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: "" },
        });
        historyIndexRef.current = -1;
        draftRef.current = "";
        return true;
      };

      const navigateHistory = (direction: "prev" | "next") => {
        const view = viewRef.current;
        if (!view) return;

        const uniqueHistory = [...new Set(history.filter(Boolean))];
        if (uniqueHistory.length === 0) return;

        if (direction === "prev") {
          if (historyIndexRef.current === -1) {
            draftRef.current = view.state.doc.toString();
            historyIndexRef.current = uniqueHistory.length - 1;
          } else if (historyIndexRef.current > 0) {
            historyIndexRef.current -= 1;
          }
        } else {
          if (historyIndexRef.current === -1) return;
          if (historyIndexRef.current < uniqueHistory.length - 1) {
            historyIndexRef.current += 1;
          } else {
            historyIndexRef.current = -1;
          }
        }

        const value = historyIndexRef.current === -1 
          ? draftRef.current 
          : uniqueHistory[historyIndexRef.current] || "";

        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
          selection: { anchor: value.length }
        });
      };

      // Construct CodeMirror EditorState
      const state = EditorState.create({
        doc: "",
        extensions: [
          vim(),
          StreamLanguage.define(shell),
          auroraTheme,
          EditorView.lineWrapping,
          keymap.of([
            {
              key: "Enter",
              run: submitCmd,
            },
            {
              key: "ArrowUp",
              run: () => {
                navigateHistory("prev");
                return true;
              },
            },
            {
              key: "ArrowDown",
              run: () => {
                navigateHistory("next");
                return true;
              },
            },
            ...defaultKeymap,
          ]),
        ],
      });

      // Spawn CodeMirror View
      const view = new EditorView({
        state,
        parent: editorRef.current,
      });

      viewRef.current = view;

      // Connect Vim mode transitions to parent callback
      const handleVimModeChange = ({ mode }: { mode: string }) => {
        if (onModeChange) {
          onModeChange(mode.toUpperCase() as EditorMode);
        }
      };

      if (CodeMirror && typeof (CodeMirror as any).on === "function") {
        (CodeMirror as any).on(Vim, "vim-mode-change", handleVimModeChange);
      }

      // Clear static modes if editor view unmounts
      return () => {
        view.destroy();
        if (CodeMirror && typeof (CodeMirror as any).off === "function") {
          (CodeMirror as any).off(Vim, "vim-mode-change", handleVimModeChange);
        }
      };
    }, [sessionId, onSubmit, history, onModeChange]);

    return (
      <div className="flex items-start gap-2.5 px-4 py-3 bg-[var(--color-term-bg)] border-t border-[var(--color-ui-border)] shadow-xl relative z-20">
        <span className="text-[var(--color-term-cursor)] font-mono text-sm select-none mt-[1px]">
          $
        </span>
        <div
          ref={editorRef}
          className="flex-1 font-mono text-sm text-[var(--color-term-fg)] min-h-[1.5em] outline-none select-text cursor-text"
        />
      </div>
    );
  }
);

InputBar.displayName = "InputBar";
