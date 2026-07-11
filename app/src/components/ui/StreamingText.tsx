import React, { useEffect, useRef, useState } from "react";

interface StreamingTextProps {
  name: string;
  streaming: boolean;
  className?: string;
}

export function StreamingText({ name, streaming, className = "" }: StreamingTextProps) {
  const [displayed, setDisplayed] = useState(streaming ? "" : name);
  const posRef = useRef(streaming ? 0 : name.length);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetRef = useRef(name);
  const streamingRef = useRef(streaming);

  useEffect(() => {
    targetRef.current = name;
    streamingRef.current = streaming;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!streaming) {
      posRef.current = name.length;
      setDisplayed(name);
      return;
    }

    posRef.current = 0;
    setDisplayed("");

    const CHARS_PER_TICK = 3;
    const INTERVAL_MS = 16;

    const tick = () => {
      if (!streamingRef.current) return;
      const target = targetRef.current;
      const next = Math.min(posRef.current + CHARS_PER_TICK, target.length);
      posRef.current = next;
      setDisplayed(target.slice(0, next));
      if (next < target.length) {
        timerRef.current = setTimeout(tick, INTERVAL_MS);
      }
    };

    timerRef.current = setTimeout(tick, INTERVAL_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [name, streaming]);

  return (
    <span className={className}>
      {displayed}
    </span>
  );
}
