import {
  type Extension,
  StateEffect,
  StateField,
  Facet,
  combineConfig,
  EditorSelection,
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

// ── Helper Utilities ─────────────────────────────────────────────────────────

function getModSymbol(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  return isMac ? "⌘" : "Ctrl";
}

function formatKeymap(keymapStr: string | undefined): string {
  if (!keymapStr) return "";
  return keymapStr.replace("Mod", getModSymbol()).replace("-", " ").toUpperCase();
}

function ce<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const elem = document.createElement(tag);
  if (className) elem.className = className;
  return elem;
}

// ── Types & Configuration ────────────────────────────────────────────────────

export interface AiOptions {
  prompt: (opts: {
    prompt: string;
    selection: string;
    codeBefore: string;
    codeAfter: string;
    signal?: AbortSignal;
  }) => Promise<string>;
  onError?: (error: Error) => void;
  onAcceptEdit?: (opts: { prompt: string; selection: string }) => void;
  onRejectEdit?: (opts: { prompt: string; selection: string }) => void;
  keymaps?: {
    showInput?: string;
    acceptEdit?: string;
    rejectEdit?: string;
  };
}

export interface InlineCompleteOptions {
  fetchFn: (state: EditorView["state"], signal: AbortSignal, view: EditorView) => Promise<string>;
  delay?: number;
}

export const defaultKeymaps = {
  showInput: "Mod-l",
  acceptEdit: "Mod-y",
  rejectEdit: "Mod-u",
};

export const optionsFacet = Facet.define<AiOptions, Required<AiOptions>>({
  combine(configs) {
    const combined = combineConfig(configs, {
      prompt: async () => "",
      onError: console.error,
      keymaps: defaultKeymaps,
    });
    combined.keymaps = { ...defaultKeymaps, ...combined.keymaps };
    return combined as Required<AiOptions>;
  },
});

// ── State Effects & Fields ───────────────────────────────────────────────────

export const showInput = StateEffect.define<{ show: boolean; lineFrom: number; lineTo: number }>();
export const setInputValue = StateEffect.define<string>();
export const setInputFocus = StateEffect.define<boolean>();
export const showCompletion = StateEffect.define<{
  from: number;
  to: number;
  oldCode: string;
  newCode: string;
} | null>();
export const setLoading = StateEffect.define<boolean>();

export const inputState = StateField.define<{ show: boolean; lineFrom: number; lineTo: number }>({
  create() {
    return { show: false, lineFrom: 0, lineTo: 0 };
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(showInput)) return e.value;
    }
    return value;
  },
});

export const inputValueState = StateField.define<{ shouldFocus: boolean; inputValue: string }>({
  create() {
    return { shouldFocus: false, inputValue: "" };
  },
  update(value, tr) {
    let updated = value;
    for (const e of tr.effects) {
      if (e.is(setInputValue)) {
        updated = { ...updated, inputValue: e.value };
      }
      if (e.is(setInputFocus)) {
        updated = { ...updated, shouldFocus: e.value };
      }
    }
    return updated;
  },
});

export const completionState = StateField.define<{
  from: number;
  to: number;
  oldCode: string;
  newCode: string;
} | null>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(showCompletion)) return e.value;
    }
    return value;
  },
});

export const loadingState = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setLoading)) return e.value;
    }
    return value;
  },
});

// ── Commands ─────────────────────────────────────────────────────────────────

export const showAiEditInput: Command = (view) => {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  console.log("showAiEditInput command run", { selEmpty: sel.empty, docLines: doc.lines });
  
  let fromLine, toLine;
  if (sel.empty) {
    fromLine = doc.lineAt(sel.head);
    toLine = fromLine;
  } else {
    fromLine = doc.lineAt(sel.from);
    toLine = doc.lineAt(sel.to);
  }

  const safeL1 = Math.max(1, Math.min(fromLine.number, doc.lines));
  const safeL2 = Math.max(1, Math.min(toLine.number, doc.lines));
  console.log("showAiEditInput computed lines", { safeL1, safeL2 });

  view.dispatch({
    effects: [
      showInput.of({ show: true, lineFrom: safeL1, lineTo: safeL2 }),
      setInputFocus.of(true),
      setInputValue.of(""),
    ],
  });
  console.log("Dispatched showInput effects");
  return true;
};

export const closeAiEditInput: Command = (view) => {
  view.dispatch({
    effects: [
      showInput.of({ show: false, lineFrom: 0, lineTo: 0 }),
      setInputFocus.of(false),
      setInputValue.of(""),
      setLoading.of(false),
      showCompletion.of(null),
    ],
  });
  return true;
};

export const acceptAiEdit: Command = (view) => {
  const c = view.state.field(completionState);
  if (!c) return false;
  const opts = view.state.facet(optionsFacet);
  opts.onAcceptEdit?.({ prompt: view.state.field(inputValueState).inputValue, selection: c.oldCode });
  view.dispatch({ effects: [showCompletion.of(null)] });
  return true;
};

export const rejectAiEdit: Command = (view) => {
  const c = view.state.field(completionState);
  if (!c) return false;
  const opts = view.state.facet(optionsFacet);
  opts.onRejectEdit?.({ prompt: view.state.field(inputValueState).inputValue, selection: c.oldCode });
  view.dispatch({
    changes: { from: c.from, to: c.to, insert: c.oldCode },
    effects: [showCompletion.of(null)],
    selection: { anchor: c.from },
  });
  return true;
};

// ── Line Shift Listener ──────────────────────────────────────────────────────

export const lineShiftListener = EditorView.updateListener.of((update) => {
  const inputStateValue = update.state.field(inputState);
  if (!inputStateValue.show || !update.docChanged) return;
  let { lineFrom, lineTo } = inputStateValue;
  let shifted = false;
  update.changes.iterChanges((fromA, _toA, fromB, toB) => {
    const changePosLine = update.state.doc.lineAt(fromA).number;
    if (changePosLine < lineFrom) {
      const linesAdded = update.state.doc.lineAt(toB).number - update.state.doc.lineAt(fromB).number;
      lineFrom += linesAdded;
      lineTo += linesAdded;
      shifted = true;
    } else if (changePosLine <= lineTo) {
      const linesAdded = update.state.doc.lineAt(toB).number - update.state.doc.lineAt(fromB).number;
      lineTo += linesAdded;
      shifted = true;
    }
  });
  if (shifted) {
    update.view.dispatch({
      effects: [showInput.of({ show: true, lineFrom, lineTo })],
    });
  }
});

// ── Tooltip Selection Trigger View Plugin ────────────────────────────────────

class TriggerPlugin {
  private view: EditorView;
  private suppress = false;
  private dom: HTMLElement;

  mousedown = () => {
    this.suppress = true;
  };

  mouseup = () => {
    this.suppress = false;
    this.display(this.view);
  };

  scroll = () => {
    this.display(this.view);
  };

  windowScroll = () => {
    this.display(this.view);
  };

  constructor(view: EditorView) {
    this.view = view;
    document.addEventListener("mousedown", this.mousedown);
    document.addEventListener("mouseup", this.mouseup);
    view.scrollDOM.addEventListener("scroll", this.scroll);
    window.addEventListener("scroll", this.windowScroll, true);

    const tooltip = ce("div", "cm-ai-tooltip");
    tooltip.style.display = "none";
    tooltip.setAttribute("aria-hidden", "true");

    const inner = ce("div", "cm-ai-tooltip-button");
    const span = ce("span");
    span.textContent = "Edit with AI ";

    const hotkey = ce("span", "hotkey");
    const options = view.state.facet(optionsFacet);
    const keymapConfig = options.keymaps;
    hotkey.textContent = formatKeymap(keymapConfig.showInput);

    span.appendChild(hotkey);
    inner.appendChild(span);
    tooltip.appendChild(inner);

    span.addEventListener("mousedown", (evt) => {
      evt.stopPropagation();
      if (evt.button === 0) {
        evt.preventDefault();
      }
    });

    span.addEventListener("click", (evt) => {
      evt.preventDefault();
      showAiEditInput(view);
    });

    view.dom.appendChild(tooltip);
    this.dom = tooltip;
  }

  update(update: ViewUpdate) {
    this.display(update.view);
  }

  docViewUpdate(view: EditorView) {
    this.display(view);
  }

  display(view: EditorView) {
    const inputStateValue = view.state.field(inputState);
    if (inputStateValue.show) {
      this.dom.style.display = "none";
      this.dom.setAttribute("aria-hidden", "true");
      return;
    }

    const completion = view.state.field(completionState);
    if (completion) {
      this.dom.style.display = "none";
      this.dom.setAttribute("aria-hidden", "true");
      return;
    }

    view.requestMeasure({
      read: this.onRead,
    });
  }

  private onRead = (view: EditorView) => {
    const range = view.state.selection.ranges.find((r) => !r.empty);
    if (range && !this.suppress) {
      const fromCoords = view.coordsAtPos(range.from);
      const toCoords = view.coordsAtPos(range.to);
      if (!fromCoords || !toCoords) return;

      const scrollRect = view.dom.getBoundingClientRect();
      const domRect = view.dom.parentElement?.getBoundingClientRect();

      const isEndInEditor = (c: { top: number; bottom: number; left: number; right: number }) =>
        c.top >= scrollRect.top &&
        c.top <= scrollRect.bottom &&
        c.left >= scrollRect.left &&
        c.left <= scrollRect.right;

      const isEndInParent = (c: { top: number; bottom: number; left: number; right: number }) =>
        !domRect ||
        (c.top >= domRect.top &&
          c.top <= domRect.bottom &&
          c.left >= domRect.left &&
          c.left <= domRect.right);

      const isInEditorViewport = isEndInEditor(fromCoords) || isEndInEditor(toCoords);
      const isInParentViewport = isEndInParent(fromCoords) || isEndInParent(toCoords);

      if (!isInEditorViewport || !isInParentViewport) {
        this.dom.style.display = "none";
        this.dom.setAttribute("aria-hidden", "true");
        return;
      }

      this.dom.style.display = "flex";
      this.dom.setAttribute("aria-hidden", "false");

      const tooltipRect = this.dom.getBoundingClientRect();
      const anchor = isEndInEditor(fromCoords) ? fromCoords : toCoords;
      const rightEdge = scrollRect.right - tooltipRect.width;
      const left = Math.min(anchor.left, rightEdge);

      let top = anchor.top - tooltipRect.height - 4;
      const minTop = domRect ? domRect.y : -Infinity;
      if (top < minTop) {
        top = toCoords.bottom + 4;
      }

      this.dom.style.left = `${left}px`;
      this.dom.style.top = `${top}px`;

      requestAnimationFrame(() => {
        if (this.dom) {
          this.dom.setAttribute("aria-hidden", "false");
        }
      });
    } else {
      this.dom.style.display = "none";
      this.dom.setAttribute("aria-hidden", "true");
    }
  };

  destroy() {
    document.removeEventListener("mousedown", this.mousedown);
    document.removeEventListener("mouseup", this.mouseup);
    this.view.scrollDOM.removeEventListener("scroll", this.scroll);
    window.removeEventListener("scroll", this.windowScroll, true);
    this.dom.remove();
  }
}

// ── Interactive UI Widgets ───────────────────────────────────────────────────

class OldCodeWidget extends WidgetType {
  constructor(private oldCode: string) {
    super();
  }

  toDOM(view: EditorView) {
    const container = ce("div", "cm-old-code-container");
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Previous code version");

    const oldCodeEl = ce("div", "cm-old-code");
    oldCodeEl.textContent = this.oldCode;

    const buttonsContainer = ce("div", "cm-floating-buttons");
    const options = view.state.facet(optionsFacet);
    const keymapConfig = options.keymaps;

    const acceptButton = ce("button", "cm-floating-button cm-floating-accept");
    acceptButton.innerHTML = `<span class="hotkey">${formatKeymap(keymapConfig.acceptEdit)}</span> Accept`;
    acceptButton.setAttribute("aria-label", "Accept changes");
    acceptButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.focus();
      acceptAiEdit(view);
    });

    const rejectButton = ce("button", "cm-floating-button cm-floating-reject");
    rejectButton.innerHTML = `<span class="hotkey">${formatKeymap(keymapConfig.rejectEdit)}</span> Reject`;
    rejectButton.setAttribute("aria-label", "Reject changes");
    rejectButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.focus();
      rejectAiEdit(view);
    });

    buttonsContainer.append(acceptButton, rejectButton);
    container.append(oldCodeEl, buttonsContainer);
    return container;
  }

  updateDOM() {
    return true;
  }

  eq(other: OldCodeWidget): boolean {
    return other instanceof OldCodeWidget && other.oldCode === this.oldCode;
  }
}

class InputWidget extends WidgetType {
  private abortController: AbortController | null = null;
  private dom: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private loadingContainer: HTMLElement | null = null;
  private helpInfo: HTMLElement | null = null;
  private inputContainer: HTMLElement | null = null;
  private form: HTMLFormElement | null = null;
  private view: EditorView | null = null;

  constructor(
    private complete: (opts: {
      prompt: string;
      selection: string;
      codeBefore: string;
      codeAfter: string;
      signal?: AbortSignal;
    }) => Promise<string>
  ) {
    super();
  }

  toDOM(view: EditorView) {
    if (this.dom) return this.dom;
    this.view = view;

    const inputValue = view.state.field(inputValueState);
    const isLoading = view.state.field(loadingState);

    const inputContainer = ce("div", "cm-ai-input-container");
    this.inputContainer = inputContainer;
    this.dom = inputContainer;

    const form = ce("form", "cm-ai-input-form");
    this.form = form;
    form.setAttribute("role", "search");
    form.setAttribute("aria-label", "AI editing instructions");
    form.addEventListener("submit", (e) => e.preventDefault());

    const input = ce("input", "cm-ai-input");
    this.input = input;
    form.append(input);
    input.placeholder = "Editing instructions...";
    input.setAttribute("aria-label", "AI editing instructions");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "true");
    input.value = inputValue.inputValue;

    const loadingContainer = ce("div", "cm-ai-loading-container");
    this.loadingContainer = loadingContainer;

    const loadingIndicator = ce("div", "cm-ai-loading-indicator");
    loadingIndicator.setAttribute("role", "status");
    loadingIndicator.setAttribute("aria-live", "polite");
    loadingIndicator.textContent = "Generating";

    const cancelButton = ce("button", "cm-ai-cancel-button");
    cancelButton.textContent = "Cancel";
    cancelButton.setAttribute("aria-label", "Cancel code generation");
    cancelButton.addEventListener("click", this.onCancel);

    loadingContainer.append(cancelButton, loadingIndicator);

    const helpInfo = ce("div", "cm-ai-help-info");
    this.helpInfo = helpInfo;

    const helpInfoButton = ce("button", "cm-ai-help-info-button");
    helpInfoButton.textContent = "Esc to close";
    helpInfoButton.addEventListener("click", this.onCancel);

    const generateButton = ce("button", "cm-ai-generate-button");
    generateButton.textContent = "⏎ Generate";
    generateButton.setAttribute("aria-label", "Generate code");
    generateButton.addEventListener("click", (e) => this.handleSubmit(e));

    this.toggleLoading(isLoading);

    if (inputValue.shouldFocus) {
      requestAnimationFrame(() => {
        input.value = inputValue.inputValue;
        input.focus();
        view.dispatch({ effects: setInputFocus.of(false) });
      });
    }

    const renderHelpInfo = (val: string) => {
      helpInfo.replaceChildren(val ? generateButton : helpInfoButton);
    };

    renderHelpInfo(input.value);

    const handleInput = () => {
      view.dispatch({ effects: setInputValue.of(input.value) });
      renderHelpInfo(input.value.trim());
    };

    input.addEventListener("input", handleInput);
    input.addEventListener("keydown", this.onKeyDown);

    return inputContainer;
  }

  toggleLoading(loading: boolean) {
    if (this.inputContainer && this.form && this.loadingContainer && this.helpInfo) {
      this.inputContainer.replaceChildren(
        this.form,
        loading ? this.loadingContainer : this.helpInfo
      );
    }
  }

  onKeyDown = async (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await this.handleSubmit();
    } else if (e.key === "Escape") {
      this.onCancel();
    }
  };

  onCancel = () => {
    this.cleanup();
    const view = this.view;
    if (!view) return;
    view.dispatch({
      effects: [showInput.of({ show: false, lineFrom: 0, lineTo: 0 }), setLoading.of(false)],
    });
    view.focus();
  };

  handleSubmit = async (e?: Event) => {
    const view = this.view;
    if (!view) return;
    const options = view.state.facet(optionsFacet);
    e?.stopPropagation();

    const state = view.state.field(inputState);
    const input = this.input;
    if (!input) return;

    const promptText = input.value.trim();
    if (!state.show || !promptText) return;

    const fromLine = view.state.doc.line(state.lineFrom);
    const toLine = view.state.doc.line(state.lineTo);
    const fromPos = fromLine.from;
    const toPos = toLine.to;

    const oldCode = view.state.sliceDoc(fromPos, toPos);
    const codeBefore = view.state.sliceDoc(0, fromPos);
    const codeAfter = view.state.sliceDoc(toPos);

    this.abortController = new AbortController();
    view.dispatch({ effects: setLoading.of(true) });
    this.toggleLoading(true);

    try {
      const result = await this.complete({
        prompt: promptText,
        selection: oldCode,
        codeBefore,
        codeAfter,
        signal: this.abortController.signal,
      });

      if (!view.state.field(inputState).show) return;

      if (!result || typeof result !== "string") {
        throw new Error("Invalid completion result");
      }

      view.dispatch({
        changes: { from: fromPos, to: toPos, insert: result },
        effects: [
          showInput.of({ show: false, lineFrom: 0, lineTo: 0 }),
          showCompletion.of({
            from: fromPos,
            to: fromPos + result.length,
            oldCode,
            newCode: result,
          }),
          setLoading.of(false),
        ],
      });
    } catch (error: any) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.cleanup();
      this.toggleLoading(false);
      view.focus();
    }
  };

  updateDOM(dom: HTMLElement) {
    this.dom = dom;
    this.input = dom.querySelector(".cm-ai-input");
    return true;
  }

  eq(other: InputWidget): boolean {
    return other instanceof InputWidget;
  }

  cleanup() {
    this.abortController?.abort();
    this.abortController = null;
    this.dom?.remove();
    this.input?.remove();
    this.dom = null;
    this.input = null;
  }

  destroy() {
    this.cleanup();
  }
}

// ── Decorations ──────────────────────────────────────────────────────────────

export const newCodeDecoration = EditorView.decorations.of((view) => {
  const completionStateValue = view.state.field(completionState);
  if (completionStateValue) {
    return Decoration.set([
      Decoration.mark({
        class: "cm-new-code-line",
      }).range(completionStateValue.from, completionStateValue.to),
    ]);
  }
  return Decoration.none;
});

export const inputPromptDecoration = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(_value, tr) {
    const inputStateValue = tr.state.field(inputState);
    const options = tr.state.facet(optionsFacet);
    const decorations = [];
    if (inputStateValue.show) {
      const lineStart = inputStateValue.lineFrom;
      const lineEnd = inputStateValue.lineTo;
      const doc = tr.state.doc;
      const safeL1 = Math.max(1, Math.min(lineStart, doc.lines));
      const safeL2 = Math.max(1, Math.min(lineEnd, doc.lines));

      for (let line = safeL1; line <= safeL2; line++) {
        const lineObj = doc.line(line);
        const pos = lineObj.from;
        decorations.push(Decoration.line({ class: "cm-ai-selection" }).range(pos));
        if (line === safeL1) {
          decorations.push(
            Decoration.widget({
              widget: new InputWidget(options.prompt),
              side: -1,
              block: true,
            }).range(pos)
          );
        }
      }
    }
    // Sort decorations by range from position first, and then place line decorations before widget decorations.
    decorations.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      const aIsLine = !a.value.spec.widget;
      const bIsLine = !b.value.spec.widget;
      if (aIsLine && !bIsLine) return -1;
      if (!aIsLine && bIsLine) return 1;
      return 0;
    });
    return Decoration.set(decorations, true);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const oldCodeDecoration = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(_oldState, tr) {
    const completionStateValue = tr.state.field(completionState);
    if (!completionStateValue) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new OldCodeWidget(completionStateValue.oldCode),
        block: true,
      }).range(completionStateValue.from),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

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
  ".cm-ai-tooltip": {
    position: "fixed",
    zIndex: "9999",
    pointerEvents: "none",
  },
  ".cm-ai-tooltip-button": {
    userSelect: "none",
    fontFamily: "inherit",
    display: "flex",
    boxSizing: "border-box",
    padding: "3px 8px 3px 10px",
    borderRadius: "6px",
    fontSize: "11px",
    backgroundColor: "rgba(20, 24, 35, 0.94)",
    color: "rgba(232, 234, 240, 0.8)",
    border: "1px solid rgba(232, 234, 240, 0.12)",
    backdropFilter: "blur(12px)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    transition: "opacity 0.3s, background-color 0.2s",
    opacity: "0",
    "&[aria-hidden='false']": {
      opacity: "1",
    },
    "& > span": {
      pointerEvents: "auto",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
    },
    "&:hover": {
      backgroundColor: "rgba(30, 36, 52, 0.96)",
      borderColor: "rgba(79, 140, 255, 0.4)",
      color: "#fff",
    },
    "& .hotkey": {
      padding: "1px 5px",
      marginLeft: "4px",
      background: "rgba(232, 234, 240, 0.08)",
      borderRadius: "3px",
      fontSize: "10px",
      color: "rgba(232, 234, 240, 0.45)",
    },
  },
  ".cm-ai-input-container": {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    width: "min(calc(100% - 16px), 500px)",
    padding: "6px 8px",
    margin: "4px 8px",
    backgroundColor: "rgba(20, 24, 35, 0.94)",
    border: "1px solid rgba(232, 234, 240, 0.10)",
    borderRadius: "8px",
    backdropFilter: "blur(12px)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
  },
  ".cm-ai-input-form": {
    margin: 0,
    padding: 0,
    width: "100%",
  },
  ".cm-ai-input": {
    display: "block",
    width: "100%",
    padding: "6px 10px",
    background: "rgba(15, 18, 25, 0.6)",
    border: "1px solid rgba(79, 140, 255, 0.35)",
    borderRadius: "5px",
    fontSize: "12px",
    color: "rgba(232, 234, 240, 0.9)",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
    "&:focus": {
      borderColor: "rgba(79, 140, 255, 0.6)",
    },
    "&::placeholder": {
      color: "rgba(232, 234, 240, 0.3)",
    },
    "&:disabled": {
      opacity: 0.5,
    },
  },
  ".cm-ai-help-info": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "2px",
  },
  ".cm-ai-help-info-button": {
    background: "none",
    border: "none",
    fontSize: "10px",
    color: "rgba(232, 234, 240, 0.35)",
    cursor: "pointer",
    padding: "2px 4px",
    fontFamily: "inherit",
    "&:hover": {
      color: "rgba(232, 234, 240, 0.7)",
    },
  },
  ".cm-ai-generate-button": {
    background: "rgba(79, 140, 255, 0.85)",
    border: "none",
    padding: "3px 10px",
    color: "#ffffff",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "11px",
    borderRadius: "4px",
    transition: "background-color 0.2s",
    marginLeft: "auto",
    "&:hover": {
      background: "rgba(79, 140, 255, 1)",
    },
  },
  ".cm-ai-loading-container": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "2px",
    width: "100%",
  },
  ".cm-ai-loading-indicator": {
    fontStyle: "italic",
    fontSize: "10px",
    color: "rgba(232, 234, 240, 0.4)",
    display: "inline-flex",
    alignItems: "center",
    "&::after": {
      content: '""',
      display: "inline-block",
      animation: "ellipsis-pulse 1.5s steps(4, end) infinite",
      width: "12px",
      textAlign: "left",
    },
  },
  ".cm-ai-cancel-button": {
    background: "none",
    border: "none",
    fontSize: "10px",
    color: "rgba(232, 234, 240, 0.4)",
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: "3px",
    fontFamily: "inherit",
    "&:hover": {
      background: "rgba(232, 234, 240, 0.06)",
      color: "rgba(232, 234, 240, 0.7)",
    },
  },
  "@keyframes ellipsis-pulse": {
    "0%": { content: "'.'" },
    "25%": { content: "'..'" },
    "50%": { content: "'...'" },
    "75%": { content: "''" },
  },
  ".cm-line.cm-ai-selection": {
    backgroundColor: "rgba(79, 140, 255, 0.08) !important",
    borderLeft: "2px solid rgba(79, 140, 255, 0.3)",
  },
  ".cm-new-code-line": {
    backgroundColor: "rgba(40, 120, 50, 0.12) !important",
    borderLeft: "2px solid rgba(60, 180, 75, 0.35)",
  },
  ".cm-old-code-container": {
    position: "relative",
    width: "100%",
    backgroundColor: "rgba(180, 50, 50, 0.12)",
    borderLeft: "2px solid rgba(220, 60, 60, 0.35)",
    padding: "4px 8px",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
  },
  ".cm-old-code": {
    margin: 0,
    padding: 0,
    fontSize: "12px",
    fontFamily: "inherit",
    color: "rgba(232, 234, 240, 0.5)",
    textDecoration: "line-through",
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  ".cm-floating-buttons": {
    position: "absolute",
    top: "-22px",
    left: "4px",
    display: "flex",
    gap: "1px",
    zIndex: "10",
  },
  ".cm-floating-button": {
    fontFamily: "inherit",
    padding: "2px 8px",
    fontSize: "10px",
    cursor: "pointer",
    fontWeight: "600",
    border: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    "& .hotkey": {
      background: "rgba(255, 255, 255, 0.15)",
      padding: "0 3px",
      borderRadius: "2px",
      fontSize: "9px",
    },
  },
  ".cm-floating-accept": {
    backgroundColor: "rgba(60, 180, 75, 0.85)",
    color: "#fff",
    borderRadius: "4px 0 0 4px",
    "&:hover": {
      backgroundColor: "rgba(60, 180, 75, 1)",
    },
  },
  ".cm-floating-reject": {
    backgroundColor: "rgba(220, 60, 60, 0.85)",
    color: "#fff",
    borderRadius: "0 4px 4px 0",
    "&:hover": {
      backgroundColor: "rgba(220, 60, 60, 1)",
    },
  },
  ".cm-ghost-text": {
    opacity: "0.4",
    fontStyle: "italic",
    pointerEvents: "none",
    userSelect: "none",
  },
});

// ── Main Export Extension ────────────────────────────────────────────────────

export function aiExtension(options: AiOptions): Extension[] {
  if (!options.prompt) {
    throw new Error("prompt function is required");
  }
  const mergedOptions = {
    ...options,
    keymaps: { ...defaultKeymaps, ...options.keymaps },
  };
  const keymapConfig = mergedOptions.keymaps;

  return [
    optionsFacet.of(mergedOptions),
    inputState,
    inputValueState,
    completionState,
    loadingState,
    ViewPlugin.fromClass(TriggerPlugin),
    aiTheme,
    keymap.of([
      {
        key: keymapConfig.showInput,
        run: showAiEditInput,
      },
      {
        key: "Escape",
        run: closeAiEditInput,
      },
    ]),
    Prec.highest([
      keymap.of([
        { key: keymapConfig.acceptEdit, run: acceptAiEdit },
        { key: keymapConfig.rejectEdit, run: rejectAiEdit },
      ]),
    ]),
    lineShiftListener,
    newCodeDecoration,
    inputPromptDecoration,
    oldCodeDecoration,
  ];
}
