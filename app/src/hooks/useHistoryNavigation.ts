import { useState, useRef, useCallback } from "react";

export function useHistoryNavigation(history: string[]) {
  const [index, setIndex] = useState(-1);
  const draftRef = useRef("");

  const uniqueHistory = [...new Set(history.filter(Boolean))];

  const navigateUp = useCallback((currentValue: string) => {
    if (index === -1) {
      draftRef.current = currentValue;
    }
    if (uniqueHistory.length === 0) return currentValue;
    const newIndex = index === -1 ? uniqueHistory.length - 1 : Math.max(0, index - 1);
    setIndex(newIndex);
    return uniqueHistory[newIndex];
  }, [index, uniqueHistory]);

  const navigateDown = useCallback(() => {
    if (uniqueHistory.length === 0) return draftRef.current;
    const newIndex = index + 1;
    if (newIndex >= uniqueHistory.length) {
      setIndex(-1);
      return draftRef.current;
    }
    setIndex(newIndex);
    return uniqueHistory[newIndex];
  }, [index, uniqueHistory]);

  const reset = useCallback(() => {
    setIndex(-1);
    draftRef.current = "";
  }, []);

  return { navigateUp, navigateDown, reset, currentIndex: index };
}
