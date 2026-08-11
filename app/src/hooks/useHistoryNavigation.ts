import { useRef, useCallback } from "react";

export function useHistoryNavigation(history: string[]) {
  const indexRef = useRef(-1);
  const draftRef = useRef("");

  const historyRef = useRef(history);
  historyRef.current = history;

  const navigateUp = useCallback((currentValue: string) => {
    const idx = indexRef.current;
    if (idx === -1) {
      draftRef.current = currentValue;
    }
    const entries = historyRef.current;
    if (entries.length === 0) return currentValue;
    const newIndex = idx === -1 ? entries.length - 1 : Math.max(0, idx - 1);
    indexRef.current = newIndex;
    return entries[newIndex];
  }, []);

  const navigateDown = useCallback((currentValue: string) => {
    const idx = indexRef.current;
    const entries = historyRef.current;
    if (entries.length === 0 || idx === -1) return currentValue;
    const newIndex = idx + 1;
    if (newIndex >= entries.length) {
      indexRef.current = -1;
      return draftRef.current;
    }
    indexRef.current = newIndex;
    return entries[newIndex];
  }, []);

  const reset = useCallback(() => {
    indexRef.current = -1;
    draftRef.current = "";
  }, []);

  return { navigateUp, navigateDown, reset };
}
