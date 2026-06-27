import { useState, useCallback } from "react";

export function useCopyWithFeedback(timeout = 2000) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, [timeout]);

  return { copied, handleCopy };
}
