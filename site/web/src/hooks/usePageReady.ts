import { useEffect, useState } from "react";
import { onPageReady } from "../lib/pageLoad";

const FALLBACK_MS = 8000;

export function usePageReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onPageReady(() => setReady(true));
    const timer = window.setTimeout(() => setReady(true), FALLBACK_MS);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  return ready;
}