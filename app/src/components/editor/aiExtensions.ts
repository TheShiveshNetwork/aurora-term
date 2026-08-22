import {
  type Extension,
  StateEffect,
  StateField,
  Prec,
} from "@codemirror/state";
import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
  keymap,
  type Command,
} from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";

// ── Types & Configuration ────────────────────────────────────────────────────

export interface InlineCompleteOptions {
  fetchFn: (state: EditorView["state"], signal: AbortSignal, view: EditorView) => Promise<string>;
  delay?: number;
}

// ── Inline Completion ────────────────────────────────────────────────────────

const setSuggestion = StateEffect.define<string | null>();

const inlineSuggField = StateField.define<{ text: string | null }>({
  create: () => ({ text: null }),
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) return { text: e.value };
    }
    if (tr.docChanged || tr.selection) return { text: null };
    return val;
  },
});

class GhostWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.textContent = this.text;
    return span;
  }

  eq(other: GhostWidget): boolean {
    return other instanceof GhostWidget && other.text === this.text;
  }
}

const ghostDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_set, tr) {
    const sugg = tr.state.field(inlineSuggField);
    if (!sugg.text) return Decoration.none;
    const pos = tr.state.selection.main.head;
    const deco = Decoration.widget({
      widget: new GhostWidget(sugg.text),
      side: 1,
    });
    return Decoration.set([deco.range(pos)]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const acceptInline: Command = (view) => {
  const status = completionStatus(view.state);
  if (status === "active") return false;

  const sugg = view.state.field(inlineSuggField);
  if (!sugg.text) return false;
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: sugg.text },
    selection: { anchor: pos + sugg.text.length },
  });
  return true;
};

const rejectInline: Command = (view) => {
  const sugg = view.state.field(inlineSuggField);
  if (!sugg.text) return false;
  view.dispatch({ effects: setSuggestion.of(null) });
  return true;
};

const inlineCompletePlugin = (opts: InlineCompleteOptions) =>
  ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private abort: AbortController | null = null;

      constructor(readonly view: EditorView) {}

      update(up: ViewUpdate) {
        if (!up.docChanged) return;

        if (this.timer) clearTimeout(this.timer);
        this.abort?.abort();
        this.abort = new AbortController();

        const signal = this.abort.signal;
        const delay = opts.delay ?? 600;

        this.timer = setTimeout(async () => {
          try {
            const result = await opts.fetchFn(up.view.state, signal, up.view);
            if (signal.aborted || !result) return;
            up.view.dispatch({ effects: setSuggestion.of(result) });
          } catch {
            // silently ignore
          }
        }, delay);
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
        this.abort?.abort();
      }
    },
  );

export function inlineCompletion(options: InlineCompleteOptions): Extension[] {
  return [
    inlineSuggField,
    ghostDecoField,
    inlineCompletePlugin(options),
    aiTheme,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptInline },
        { key: "Escape", run: rejectInline },
      ])
    ),
  ];
}

// ── Theme ────────────────────────────────────────────────────────────────────

export const aiTheme = EditorView.baseTheme({
  ".cm-ghost-text": {
    opacity: "0.4",
    fontStyle: "italic",
    pointerEvents: "none",
    userSelect: "none",
  },
});
