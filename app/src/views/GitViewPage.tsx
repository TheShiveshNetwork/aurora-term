import React, { useMemo } from "react";
import { GitBranch } from "lucide-react";
import { GitView } from "../components/git/GitView";
import { WindowControls } from "../components/ui/WindowControls";
import { useAppBootstrap } from "../hooks/useAppBootstrap";

export default function GitViewPage() {
  useAppBootstrap();
  const params = new URLSearchParams(window.location.search);
  const projectDir = params.get("projectDir") || "";
  const projectName = useMemo(() => projectDir.split(/[/\\]/).filter(Boolean).pop() || projectDir, [projectDir]);

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none bg-background text-on-surface">
      <header
        data-tauri-drag-region
        className="flex items-center justify-between h-auto pl-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center gap-2">
          <GitBranch size={12} style={{ color: "rgba(232,234,240,0.4)" }} />
          <span className="text-xs font-semibold tracking-wider select-none" style={{ color: "rgba(232,234,240,0.4)" }}>
            {projectName} Git View
          </span>
        </div>
        <WindowControls />
      </header>
      <div className="flex-1 min-h-0 overflow-auto">
        <GitView cwd={projectDir} tabId="gitview-window" />
      </div>
    </div>
  );
}
