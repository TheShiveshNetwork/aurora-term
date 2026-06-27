import { useState, useRef, useCallback, useEffect } from "react";

interface UseDragResizeOptions {
  axis: "x" | "y";
  min: number;
  max: number;
  initial: number;
  onResize?: (size: number) => void;
}

export function useDragResize({ axis, min, max, initial, onResize }: UseDragResizeOptions) {
  const [size, setSize] = useState(initial);
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(initial);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startPos.current = axis === "x" ? e.clientX : e.clientY;
    startSize.current = size;
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [axis, size]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = axis === "x" ? e.clientX - startPos.current : e.clientY - startPos.current;
      const newSize = Math.min(max, Math.max(min, startSize.current + (axis === "x" ? delta : delta)));
      setSize(newSize);
      onResize?.(newSize);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [axis, min, max, onResize]);

  return { size, onMouseDown, isDragging: isDragging.current };
}
