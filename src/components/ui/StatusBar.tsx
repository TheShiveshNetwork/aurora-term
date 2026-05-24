import React, { useEffect, useRef, useState } from "react";
import { Cpu, GitBranch, Wifi, FileText, Copy, Folder } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "../../stores/useAIStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useSessionStore } from "../../stores/useSessionStore";

interface SystemInfo {
  ram_used_mb: number;
  ram_total_mb: number;
  git_branch: string | null;
  encoding: string;
}

function formatRam(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function StatusBar({ cwd }: { cwd?: string }) {
  const { activeProvider } = useAIStore();
  const { mode } = useSettingsStore();
  const { tabs, activeTabId } = useSessionStore();
  const activeFileTab = tabs.find(t => t.id === activeTabId && t.type === "file");
  const [showPathTooltip, setShowPathTooltip] = useState(false);
  const [tooltipCopied, setTooltipCopied] = useState(false);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo>({
    ram_used_mb: 0,
    ram_total_mb: 0,
    git_branch: null,
    encoding: "UTF-8",
  });

  useEffect(() => {
    async function fetchInfo() {
      try {
        const info = await invoke<SystemInfo>("get_system_info", { cwd: null });
        setSysInfo(info);
      } catch (e) {
        // fallback — keep defaults
      }
    }

    fetchInfo();
    // Refresh every 8 seconds
    const interval = setInterval(fetchInfo, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer id="aurora-status-bar" className="flex justify-between items-center px-4 h-7 w-full bg-surface-container-lowest border-t border-outline-variant/5 z-50 select-none text-[10px] font-code-sm font-medium">
      {/* Left side */}
      <div className="flex items-center gap-4">
        {/* Git branch */}
        {sysInfo.git_branch && (
          <div className="flex items-center gap-1.5 text-on-surface-variant/70">
            <GitBranch size={10} className="text-tertiary/70" />
            <span className="text-tertiary">{sysInfo.git_branch}</span>
          </div>
        )}

        {/* Current Working Directory (CWD) */}
        {cwd && (
          <>
            {sysInfo.git_branch && <span className="text-outline/30 mx-0.5">|</span>}
            <div className="flex items-center gap-1.5 text-on-surface-variant/70">
              <Folder size={10} className="text-primary/70 shrink-0" />
              <span className="text-primary truncate max-w-[280px]" title={cwd}>
                {cwd}
              </span>
            </div>
          </>
        )}

        {/* Active file name — shown when a file tab is active */}
        {activeFileTab && (
          <>
            {(sysInfo.git_branch || cwd) && <span className="text-outline/30 mx-0.5">|</span>}
            <div
              className="relative flex items-center gap-1.5 text-on-surface-variant/80 group cursor-pointer"
              onMouseEnter={() => setShowPathTooltip(true)}
              onMouseLeave={() => {
                setShowPathTooltip(false);
                setTooltipCopied(false);
                if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
              }}
              onClick={() => {
                navigator.clipboard.writeText(activeFileTab.filePath || "");
                setTooltipCopied(true);
                if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
                tooltipTimeoutRef.current = setTimeout(() => setTooltipCopied(false), 1500);
              }}
            >
              <FileText size={10} className="text-primary/70 shrink-0" />
              <span className="text-primary max-w-[160px] truncate">{activeFileTab.name}</span>

              {/* Tooltip pane */}
              {showPathTooltip && (
                <div
                  className="absolute bottom-[calc(100%+6px)] left-0 bg-surface-container-high border border-outline-variant/20 rounded-lg px-3 py-2 shadow-xl z-[100] whitespace-nowrap flex items-center gap-2"
                  style={{ pointerEvents: "auto" }}
                >
                  <span className="text-[10px] font-code-sm text-on-surface-variant/70 max-w-[360px] truncate">
                    {activeFileTab.filePath}
                  </span>
                  {tooltipCopied ? (
                    <span className="text-[9px] text-primary/80 shrink-0">Copied!</span>
                  ) : (
                    <Copy size={10} className="text-outline/50 shrink-0" />
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Mode pill */}
        {/* <div className="flex items-center gap-1.5 text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-container shadow-[0_0_4px_#00f0ff] animate-pulse" />
          <span className="uppercase text-[9px] tracking-wide">{mode} MODE</span>
        </div> */}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* RAM usage — always shown, shows "…" while loading */}
        <div className="flex items-center gap-1.5 text-on-surface-variant/70">
          <Cpu size={10} className="text-primary/70" />
          <span>
            {sysInfo.ram_total_mb > 0
              ? `${formatRam(sysInfo.ram_used_mb)} / ${formatRam(sysInfo.ram_total_mb)}`
              : "RAM …"}
          </span>
        </div>

        <span className="text-outline/40">•</span>

        {/* AI engine */}
        <div className="flex items-center gap-1.5 text-secondary">
          <Wifi size={10} className="text-secondary/70" />
          <span className="capitalize">{activeProvider} Engine</span>
        </div>

        {/*
        <span className="text-outline/40">•</span>
        
        <span className="text-on-surface-variant/60 font-mono uppercase tracking-wider">
          {sysInfo.encoding}
        </span>*/}
      </div>
    </footer>
  );
}
