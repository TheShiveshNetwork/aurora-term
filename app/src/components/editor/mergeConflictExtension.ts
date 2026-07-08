import { type Extension, StateField } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, WidgetType } from "@codemirror/view";

interface ConflictBlock {
  from: number;
  to: number;
  currentStart: number;
  currentEnd: number;
  baseStart?: number;
  baseEnd?: number;
  incomingStart: number;
  incomingEnd: number;
  currentLabel: string;
  incomingLabel: string;
}

function findConflicts(text: string): ConflictBlock[] {
  const lines = text.split("\n");
  const conflicts: ConflictBlock[] = [];
  let i = 0;
  
  let charOffset = 0;
  const lineOffsets: number[] = [];
  for (const line of lines) {
    lineOffsets.push(charOffset);
    charOffset += line.length + 1; // +1 for newline
  }

  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<<")) {
      const startLine = i;
      const currentLabel = lines[i].slice(7).trim() || "Current Change";
      
      let baseStartLine: number | undefined;
      let baseEndLine: number | undefined;
      let separatorLine: number | undefined;
      let endLine: number | undefined;
      
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].startsWith("|||||||")) {
          baseStartLine = j;
        } else if (lines[j] === "=======") {
          separatorLine = j;
          if (baseStartLine !== undefined) {
            baseEndLine = j;
          }
        } else if (lines[j].startsWith(">>>>>>>")) {
          endLine = j;
          break;
        }
        j++;
      }
      
      if (separatorLine !== undefined && endLine !== undefined) {
        const incomingLabel = lines[endLine].slice(7).trim() || "Incoming Change";
        
        const conflictFrom = lineOffsets[startLine];
        const nextLineOffset = endLine + 1 < lines.length ? lineOffsets[endLine + 1] : charOffset;
        const conflictTo = nextLineOffset;

        const currentStart = lineOffsets[startLine + 1];
        const currentEnd = baseStartLine !== undefined ? lineOffsets[baseStartLine] : lineOffsets[separatorLine];

        const baseStart = baseStartLine !== undefined ? lineOffsets[baseStartLine + 1] : undefined;
        const baseEnd = baseEndLine !== undefined ? lineOffsets[baseEndLine] : undefined;

        const incomingStart = lineOffsets[separatorLine + 1];
        const incomingEnd = lineOffsets[endLine];

        conflicts.push({
          from: conflictFrom,
          to: conflictTo,
          currentStart,
          currentEnd,
          baseStart,
          baseEnd,
          incomingStart,
          incomingEnd,
          currentLabel,
          incomingLabel,
        });
        
        i = endLine + 1;
        continue;
      }
    }
    i++;
  }
  
  return conflicts;
}

function resolveConflict(view: EditorView, c: ConflictBlock, action: "current" | "incoming" | "both") {
  let insertText = "";
  const doc = view.state.doc;
  if (action === "current") {
    insertText = doc.sliceString(c.currentStart, c.currentEnd);
  } else if (action === "incoming") {
    insertText = doc.sliceString(c.incomingStart, c.incomingEnd);
  } else if (action === "both") {
    insertText =
      doc.sliceString(c.currentStart, c.currentEnd) +
      doc.sliceString(c.incomingStart, c.incomingEnd);
  }

  view.dispatch({
    changes: {
      from: c.from,
      to: c.to,
      insert: insertText,
    },
  });
}

class ConflictActionsWidget extends WidgetType {
  constructor(private conflict: ConflictBlock) {
    super();
  }

  eq(other: ConflictActionsWidget) {
    return (
      this.conflict.from === other.conflict.from &&
      this.conflict.to === other.conflict.to
    );
  }

  toDOM(view: EditorView) {
    const div = document.createElement("div");
    div.className = "cm-merge-conflict-actions";

    const label = document.createElement("span");
    label.className = "cm-merge-conflict-title";
    label.innerText = `Conflict (${this.conflict.currentLabel} vs ${this.conflict.incomingLabel}):`;
    div.appendChild(label);

    const btnCurrent = document.createElement("button");
    btnCurrent.className = "cm-merge-conflict-btn current";
    btnCurrent.innerText = "Accept Current";
    btnCurrent.onclick = (e) => {
      e.preventDefault();
      resolveConflict(view, this.conflict, "current");
    };
    div.appendChild(btnCurrent);

    const btnIncoming = document.createElement("button");
    btnIncoming.className = "cm-merge-conflict-btn incoming";
    btnIncoming.innerText = "Accept Incoming";
    btnIncoming.onclick = (e) => {
      e.preventDefault();
      resolveConflict(view, this.conflict, "incoming");
    };
    div.appendChild(btnIncoming);

    const btnBoth = document.createElement("button");
    btnBoth.className = "cm-merge-conflict-btn both";
    btnBoth.innerText = "Accept Both";
    btnBoth.onclick = (e) => {
      e.preventDefault();
      resolveConflict(view, this.conflict, "both");
    };
    div.appendChild(btnBoth);

    return div;
  }
}

function buildConflictDecorations(state: any): DecorationSet {
  const text = state.doc.toString();
  const conflicts = findConflicts(text);
  const deco: any[] = [];

  for (const c of conflicts) {
    deco.push(
      Decoration.widget({
        widget: new ConflictActionsWidget(c),
        side: -1,
        block: true,
      }).range(c.from)
    );

    // HEAD header line
    deco.push(Decoration.line({ class: "cm-conflict-header cm-conflict-header-current" }).range(c.from));
    
    // ours lines
    let pos = c.currentStart;
    while (pos < c.currentEnd) {
      const line = state.doc.lineAt(pos);
      deco.push(Decoration.line({ class: "cm-conflict-line-current" }).range(line.from));
      pos = line.to + 1;
    }
    
    // base lines (if present)
    if (c.baseStart !== undefined && c.baseEnd !== undefined) {
      deco.push(Decoration.line({ class: "cm-conflict-header cm-conflict-header-base" }).range(c.currentEnd));
      let bPos = c.baseStart;
      while (bPos < c.baseEnd) {
        const line = state.doc.lineAt(bPos);
        deco.push(Decoration.line({ class: "cm-conflict-line-base" }).range(line.from));
        bPos = line.to + 1;
      }
    }
    
    // separator line
    const sepPos = c.baseEnd !== undefined ? c.baseEnd : c.currentEnd;
    deco.push(Decoration.line({ class: "cm-conflict-separator" }).range(sepPos));
    
    // theirs lines
    let iPos = c.incomingStart;
    while (iPos < c.incomingEnd) {
      const line = state.doc.lineAt(iPos);
      deco.push(Decoration.line({ class: "cm-conflict-line-incoming" }).range(line.from));
      iPos = line.to + 1;
    }
    
    // end header line
    deco.push(Decoration.line({ class: "cm-conflict-header cm-conflict-header-incoming" }).range(c.incomingEnd));
  }

  return Decoration.set(deco, true);
}

export const mergeConflictField = StateField.define<DecorationSet>({
  create(state) {
    return buildConflictDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged) {
      return buildConflictDecorations(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const mergeConflictTheme = EditorView.baseTheme({
  ".cm-merge-conflict-actions": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 12px",
    backgroundColor: "rgba(20, 24, 35, 0.94)",
    border: "1px solid rgba(232, 234, 240, 0.10)",
    borderRadius: "6px 6px 0 0",
    backdropFilter: "blur(12px)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  ".cm-merge-conflict-title": {
    fontSize: "11px",
    fontWeight: "600",
    color: "rgba(232, 234, 240, 0.45)",
    marginRight: "6px",
  },
  ".cm-merge-conflict-btn": {
    border: "none",
    padding: "3px 8px",
    fontSize: "10px",
    fontWeight: "600",
    cursor: "pointer",
    borderRadius: "4px",
    fontFamily: "inherit",
    transition: "background-color 0.15s, opacity 0.15s",
    "&:hover": {
      opacity: "0.9",
    },
  },
  ".cm-merge-conflict-btn.current": {
    backgroundColor: "rgba(80, 227, 194, 0.2)",
    color: "#50E3C2",
    border: "1px solid rgba(80, 227, 194, 0.35)",
  },
  ".cm-merge-conflict-btn.incoming": {
    backgroundColor: "rgba(79, 140, 255, 0.2)",
    color: "#4F8CFF",
    border: "1px solid rgba(79, 140, 255, 0.35)",
  },
  ".cm-merge-conflict-btn.both": {
    backgroundColor: "rgba(232, 234, 240, 0.1)",
    color: "rgba(232, 234, 240, 0.8)",
    border: "1px solid rgba(232, 234, 240, 0.15)",
  },
  ".cm-conflict-line-current": {
    backgroundColor: "rgba(80, 227, 194, 0.08) !important",
  },
  ".cm-conflict-line-incoming": {
    backgroundColor: "rgba(79, 140, 255, 0.08) !important",
  },
  ".cm-conflict-line-base": {
    backgroundColor: "rgba(232, 234, 240, 0.04) !important",
  },
  ".cm-conflict-header": {
    fontFamily: "monospace",
    fontSize: "12px",
    opacity: "0.85",
  },
  ".cm-conflict-header-current": {
    backgroundColor: "rgba(80, 227, 194, 0.15) !important",
    borderTop: "1px solid rgba(80, 227, 194, 0.4)",
    borderBottom: "1px solid rgba(80, 227, 194, 0.15)",
  },
  ".cm-conflict-header-incoming": {
    backgroundColor: "rgba(79, 140, 255, 0.15) !important",
    borderTop: "1px solid rgba(79, 140, 255, 0.15)",
    borderBottom: "1px solid rgba(79, 140, 255, 0.4)",
  },
  ".cm-conflict-header-base": {
    backgroundColor: "rgba(232, 234, 240, 0.08) !important",
    borderTop: "1px dashed rgba(232, 234, 240, 0.15)",
    borderBottom: "1px dashed rgba(232, 234, 240, 0.15)",
  },
  ".cm-conflict-separator": {
    backgroundColor: "rgba(232, 234, 240, 0.04) !important",
    borderTop: "1px dashed rgba(232, 234, 240, 0.2)",
    borderBottom: "1px dashed rgba(232, 234, 240, 0.2)",
  },
});

export function mergeConflictResolver(): Extension[] {
  return [mergeConflictField, mergeConflictTheme];
}
