import { useState, useEffect, useRef, useCallback } from "react";
import { AgentOverlay } from "../agents/AgentOverlay";
import { AgentDetails } from "../agents/AgentDetails";

interface RightPanelProps {
  viewMode: "terminal" | "file" | "agent";
  sessionId: string | null;
  onClose?: () => void;
}

export function RightPanel({ viewMode, sessionId, onClose }: RightPanelProps) {
  const isAgentView = viewMode === "agent";

  // Width drag states
  const MIN_PANEL_WIDTH = 240;
  const MAX_PANEL_WIDTH = 600;
  const [width, setWidth] = useState(380);
  const panelDragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    panelDragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = panelDragRef.current;
      if (!d) return;
      const delta = d.startX - e.clientX;
      setWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, d.startW + delta)));
    };
    const onUp = () => {
      if (!panelDragRef.current) return;
      panelDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      className="relative flex flex-col z-25 bg-[#0F131A] border-l border-white/[0.06]"
      style={{
        width,
        minWidth: MIN_PANEL_WIDTH,
        maxWidth: MAX_PANEL_WIDTH,
      }}
    >
      {/* Resize handle on left edge */}
      <div
        onMouseDown={onDragHandleMouseDown}
        className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize z-30 group select-none"
        title="Drag to resize"
      >
        <div
          className="w-px h-full mr-auto transition-colors"
          style={{ background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.35)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        />
      </div>

      {/* Render correct panel based on viewMode */}
      {isAgentView ? (
        <AgentDetails sessionId={sessionId} onClose={onClose} />
      ) : (
        <AgentOverlay sessionId={sessionId} onClose={onClose} />
      )}
    </div>
  );
}
export default RightPanel;
