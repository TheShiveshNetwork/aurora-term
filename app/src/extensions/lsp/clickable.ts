import { EditorView, Decoration, DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, EditorState, Extension } from "@codemirror/state";

// Shows the familiar "Ctrl/Cmd-hover = clickable" affordance: while the
// modifier is held, the word under the pointer is underlined and the cursor
// becomes a pointer, mirroring VS Code / the official LSP editor experience.
// The actual jump is performed by the library's `jumpToDefinition` command
// (bound to Ctrl/Cmd+click and F12 elsewhere), not here.

const setMod = StateEffect.define<boolean>();
const setRange = StateEffect.define<{ from: number; to: number } | null>();

interface Clickable {
  mod: boolean;
  range: { from: number; to: number } | null;
}

function wordAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;
  const isWord = (ch: string) => ch !== "" && /[\p{L}\p{N}_$]/u.test(ch);
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  if (start === end) return null;
  return { from: line.from + start, to: line.from + end };
}

const isModKey = (e: KeyboardEvent) => e.key === "Control" || e.key === "Meta";

export function lspClickable(): Extension {
  const field = StateField.define<Clickable>({
    create: () => ({ mod: false, range: null }),
    update(value, tr) {
      let next = value;
      for (const e of tr.effects) {
        if (e.is(setMod)) next = { ...next, mod: e.value };
        else if (e.is(setRange)) next = { ...next, range: e.value };
      }
      if (!next.mod) next = { ...next, range: null };
      if (next.range && tr.docChanged) {
        const from = tr.changes.mapPos(next.range.from, -1);
        const to = tr.changes.mapPos(next.range.to, 1);
        next = { ...next, range: from <= to ? { from, to } : null };
      }
      return next;
    },
    provide: (f) =>
      EditorView.decorations.from(f, (v) => {
        if (!v.mod || !v.range) return Decoration.none;
        return Decoration.set([
          Decoration.mark({ class: "cm-lsp-clickable" }).range(v.range.from, v.range.to),
        ]);
      }),
  });

  const handlers = EditorView.domEventHandlers({
    keydown(e, view) {
      if (isModKey(e) && !view.state.field(field).mod) {
        view.dispatch({ effects: setMod.of(true) });
      }
      return false;
    },
    keyup(e, view) {
      if (isModKey(e) && view.state.field(field).mod) {
        view.dispatch({ effects: setMod.of(false) });
      }
      return false;
    },
    blur(_e, view) {
      if (view.state.field(field).mod) view.dispatch({ effects: setMod.of(false) });
      return false;
    },
    mousemove(e, view) {
      const st = view.state.field(field);
      if (!st.mod) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      const word = pos == null ? null : wordAt(view.state, pos);
      const cur = st.range;
      if (!word) {
        if (cur) view.dispatch({ effects: setRange.of(null) });
        return false;
      }
      if (!cur || cur.from !== word.from || cur.to !== word.to) {
        view.dispatch({ effects: setRange.of(word) });
      }
      return false;
    },
    mouseleave(_e, view) {
      if (view.state.field(field).range) view.dispatch({ effects: setRange.of(null) });
      return false;
    },
  });

  return [field, handlers];
}
