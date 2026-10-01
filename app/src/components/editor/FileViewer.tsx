import React, { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useSessionStore } from "../../stores/useSessionStore";
import { getRendererType, RendererType } from "./renderers/fileRendererFactory";
import { CodeRenderer } from "./renderers/CodeRenderer";
import { MediaRenderer } from "./renderers/media/MediaRenderer";

interface FileViewerProps {
  tabId: string;
  filePath: string;
  fileName: string;
}

export function FileViewer({ tabId, filePath, fileName }: FileViewerProps) {
  const tab = useSessionStore((s) => s.tabs.find((t) => t.id === tabId));
  const isMissing = tab?.missing ?? false;
  const rendererType = useMemo(() => getRendererType(filePath), [filePath]);

  return (
    <div className="flex flex-col h-full w-full bg-surface-container-low">
      <div className="flex-1 overflow-hidden w-full relative">
        {isMissing ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low/80 z-20">
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <AlertCircle size={32} className="text-amber-400" />
              <span className="text-sm text-on-surface font-medium">File has been deleted</span>
              <span className="text-xs text-on-surface-variant">{filePath}</span>
            </div>
          </div>
        ) : rendererType === RendererType.CODE ? (
          <CodeRenderer tabId={tabId} filePath={filePath} fileName={fileName} />
        ) : (
          <MediaRenderer filePath={filePath} fileName={fileName} />
        )}
      </div>
    </div>
  );
}
