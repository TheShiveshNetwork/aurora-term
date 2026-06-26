import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { setSearchQuery, SearchQuery, findNext, findPrevious, replaceAll, selectSelectionMatches } from "@codemirror/search";
import { X, ChevronDown, ArrowUp, ArrowDown, Combine } from "lucide-react";

interface SearchPanelProps {
  view: EditorView;
  onClose: () => void;
}

function countMatches(view: EditorView, query: SearchQuery): number {
  const cursor = query.getCursor(view.state);
  let count = 0;
  let result = cursor.next();
  while (!result.done) { count++; result = cursor.next(); }
  return count;
}

function currentMatchIndex(view: EditorView, query: SearchQuery): number {
  const main = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let idx = 0;
  let closest = -1;
  let result = cursor.next();
  while (!result.done) {
    idx++;
    if (closest === -1 && result.value.from >= main.from) closest = idx;
    result = cursor.next();
  }
  return closest === -1 && idx > 0 ? 1 : closest;
}

export function SearchPanel({ view, onClose }: SearchPanelProps) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [matchTotal, setMatchTotal] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findRef.current?.focus();
  }, []);

  const doSearch = useCallback((text: string) => {
    if (text) {
      const query = new SearchQuery({ search: text, caseSensitive: false });
      view.dispatch({ effects: setSearchQuery.of(query) });
      setMatchTotal(countMatches(view, query));
      setMatchIdx(currentMatchIndex(view, query));
    } else {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
      setMatchTotal(0);
      setMatchIdx(0);
    }
  }, [view]);

  const handleFindChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setFindText(text);
    doSearch(text);
  }, [doSearch]);

  const goNext = useCallback(() => {
    if (findText) {
      findNext(view);
      const query = new SearchQuery({ search: findText, caseSensitive: false });
      setMatchIdx(currentMatchIndex(view, query));
    }
  }, [view, findText]);

  const goPrev = useCallback(() => {
    if (findText) {
      findPrevious(view);
      const query = new SearchQuery({ search: findText, caseSensitive: false });
      setMatchIdx(currentMatchIndex(view, query));
    }
  }, [view, findText]);

  const handleReplaceAll = useCallback(() => {
    if (findText) {
      const query = new SearchQuery({ search: findText, replace: replaceText, caseSensitive: false });
      view.dispatch({ effects: setSearchQuery.of(query) });
      replaceAll(view);
      setFindText("");
      setReplaceText("");
      setMatchTotal(0);
      setMatchIdx(0);
      view.focus();
    }
  }, [view, findText, replaceText]);

  const handleChangeAll = useCallback(() => {
    if (findText) {
      const query = new SearchQuery({ search: findText, caseSensitive: false });
      view.dispatch({ effects: setSearchQuery.of(query) });
      selectSelectionMatches(view);
      handleClose();
    }
  }, [view, findText]);

  const handleClose = useCallback(() => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
    view.focus();
    onClose();
  }, [view, onClose]);

  const handleFindKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      goPrev();
    } else if (e.key === "Enter") {
      e.preventDefault();
      goNext();
    } else if (e.key === "Escape") {
      handleClose();
    }
  }, [goNext, goPrev, handleClose]);

  const handleReplaceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleReplaceAll();
    } else if (e.key === "Escape") {
      handleClose();
    }
  }, [handleReplaceAll, handleClose]);

  return (
    <div
      className="absolute top-3 right-3 z-30 min-w-[300px] overflow-hidden rounded-xl shadow-2xl bg-[rgba(15,18,25,0.85)] border border-white/8"
      style={{
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      <div className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5">
        <div className="flex-1 flex items-center">
          <input
            ref={findRef}
            type="text"
            value={findText}
            onChange={handleFindChange}
            onKeyDown={handleFindKeyDown}
            placeholder="Find"
            className="w-full bg-transparent border-none outline-none text-[13px] text-white placeholder:text-white/25"
          />
        </div>
        <span className="text-[11px] text-white/35 min-w-[36px] text-right tabular-nums select-none">
          {matchTotal > 0 ? `${matchIdx}/${matchTotal}` : "0/0"}
        </span>
        <button
          onClick={goPrev}
          disabled={!findText}
          className="p-1 rounded hover:bg-white/8 text-white/45 hover:text-white/80 disabled:opacity-20 disabled:cursor-default"
        >
          <ArrowUp size={13} />
        </button>
        <button
          onClick={goNext}
          disabled={!findText}
          className="p-1 rounded hover:bg-white/8 text-white/45 hover:text-white/80 disabled:opacity-20 disabled:cursor-default"
        >
          <ArrowDown size={13} />
        </button>
        <button
          onClick={() => setShowReplace(s => !s)}
          className="p-1 rounded hover:bg-white/8 text-white/45 hover:text-white/80"
          title="Toggle replace"
        >
          <ChevronDown size={13} className={`transition-transform ${showReplace ? "rotate-180" : ""}`} />
        </button>
        <button
          onClick={handleClose}
          className="p-1 rounded hover:bg-white/8 text-white/45 hover:text-white/80"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 border-t border-white/6">
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace"
            className="flex-1 bg-transparent border-none outline-none text-[13px] text-white placeholder:text-white/25"
          />
          <button
            onClick={handleChangeAll}
            disabled={!findText}
            className="px-2 py-1 text-[11px] font-medium rounded-md bg-white/8 text-white/60 hover:bg-white/12 disabled:opacity-25 transition-colors"
            title="Select all occurrences with multiple cursors"
          >
            <Combine size={12} className="inline mr-1" />
            Change All
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={!findText}
            className="px-2 py-1 text-[11px] font-medium rounded-md bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-25 transition-colors"
          >
            Replace All
          </button>
        </div>
      )}
    </div>
  );
}
