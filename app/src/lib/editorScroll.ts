import { EditorView, type Command } from "@codemirror/view";
import { findNext as cmFindNext, findPrevious as cmFindPrevious } from "@codemirror/search";

// Scroll the editor viewport so `pos` sits roughly vertically centered, with a
// small margin so matches/definitions aren't jammed against the edge.
export function centerOnPos(view: EditorView, pos: number): void {
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center", yMargin: 48 }) });
}

// Scroll so `from` is centered and select the [from, to] range.
export function centerOnRange(view: EditorView, from: number, to: number, focus = true): void {
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: "center", yMargin: 48 }),
  });
  if (focus) view.focus();
}

// Centered variants of the in-file find commands. The built-in `findNext` /
// `findPrevious` scroll the match to the nearest (bottom) edge; we re-scroll it
// to the center afterwards so it's always comfortably visible.
export const centerFindNext: Command = (view) => {
  const ok = cmFindNext(view);
  if (ok) centerOnPos(view, view.state.selection.main.head);
  return ok;
};

export const centerFindPrevious: Command = (view) => {
  const ok = cmFindPrevious(view);
  if (ok) centerOnPos(view, view.state.selection.main.head);
  return ok;
};
