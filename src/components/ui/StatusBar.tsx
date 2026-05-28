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
  const [showCwdTooltip, setShowCwdTooltip] = useState(false);
  const [cwdCopied, setCwdCopied] = useState(false);
  const cwdTooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo>({
    ram_used_mb: 0,
    ram_total_mb: 0,
    git_branch: null,
    encoding: "UTF-8",
  });

  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  useEffect(() => {
    async function fetchInfo(force: boolean = false) {
      try {
        const info = await invoke<SystemInfo>("get_system_info", {
          cwd: cwdRef.current,
          force
        });
        setSysInfo(info);
      } catch (e) {
        // fallback — keep defaults
      }
    }

    fetchInfo(false);

    const handleCwdChange = (e: Event) => {
      const { sessionId } = (e as CustomEvent<{ path: string; sessionId: string }>).detail;
      if (sessionId === activeTabId) {
        fetchInfo(true);
      }
    };

    window.addEventListener("cwd-change", handleCwdChange);
    const interval = setInterval(() => fetchInfo(false), 30000);

    return () => {
      window.removeEventListener("cwd-change", handleCwdChange);
      clearInterval(interval);
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
      if (cwdTooltipTimeoutRef.current) clearTimeout(cwdTooltipTimeoutRef.current);
    };
  }, [cwd, activeTabId]);

  return (
    <footer id="aurora-status-bar" className="flex justify-between items-center px-4 h-7 w-full bg-surface-container-lowest border-t border-outline-variant/5 z-50 select-none text-[12px] font-medium">
      {/* Left side */}
      <div className="flex items-center gap-4">
        {/* Git branch */}
        {sysInfo.git_branch && (
          <div className="flex items-center gap-1.5 text-on-surface-variant/70">
            <GitBranch size={12} className="text-tertiary/70" />
            <span className="text-tertiary">{sysInfo.git_branch}</span>
          </div>
        )}

        {/* Current Working Directory (CWD) and Active File */}
        {cwd && (
          <>
            {sysInfo.git_branch && <span className="text-outline/30 mx-0.5">|</span>}
            <div className="flex items-center text-primary">
              <Folder size={12} className="text-primary/70 shrink-0 mr-1.5" />

              {/* Folder name (with hover tooltip and click-to-copy complete path) */}
              <div
                className="relative cursor-pointer hover:underline text-primary"
                onMouseEnter={() => setShowCwdTooltip(true)}
                onMouseLeave={() => {
                  setShowCwdTooltip(false);
                  setCwdCopied(false);
                  if (cwdTooltipTimeoutRef.current) clearTimeout(cwdTooltipTimeoutRef.current);
                }}
                onClick={() => {
                  navigator.clipboard.writeText(cwd || "");
                  setCwdCopied(true);
                  if (cwdTooltipTimeoutRef.current) clearTimeout(cwdTooltipTimeoutRef.current);
                  cwdTooltipTimeoutRef.current = setTimeout(() => setCwdCopied(false), 1500);
                }}
              >
                {cwd.split(/[/\\]/).filter(Boolean).pop() || cwd}

                {/* Tooltip pane */}
                {showCwdTooltip && (
                  <div
                    className="absolute bottom-[calc(100%+6px)] left-0 bg-surface-container-high border border-outline-variant/20 rounded-lg px-3 py-2 shadow-xl z-[100] whitespace-nowrap flex items-center gap-2"
                    style={{ pointerEvents: "auto" }}
                  >
                    <span className="text-[10px] text-on-surface-variant/70 max-w-[360px] truncate">
                      {cwd}
                    </span>
                    {cwdCopied ? (
                      <span className="text-[9px] text-primary/80 shrink-0">Copied!</span>
                    ) : (
                      <Copy size={12} className="text-outline/50 shrink-0" />
                    )}
                  </div>
                )}
              </div>

              {activeFileTab && (
                <>
                  <span className="text-outline mx-0.5 select-none">/</span>
                  {/* File name (with hover tooltip and click-to-copy complete path) */}
                  <div
                    className="relative cursor-pointer hover:underline text-primary"
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
                    {activeFileTab.name}

                    {/* Tooltip pane */}
                    {showPathTooltip && (
                      <div
                        className="absolute bottom-[calc(100%+6px)] left-0 bg-surface-container-high border border-outline-variant/20 rounded-lg px-3 py-2 shadow-xl z-[100] whitespace-nowrap flex items-center gap-2"
                        style={{ pointerEvents: "auto" }}
                      >
                        <span className="text-[10px] text-on-surface-variant/70 max-w-[360px] truncate">
                          {activeFileTab.filePath}
                        </span>
                        {tooltipCopied ? (
                          <span className="text-[9px] text-primary/80 shrink-0">Copied!</span>
                        ) : (
                          <Copy size={12} className="text-outline/50 shrink-0" />
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* RAM usage — always shown, shows "…" while loading */}
        <div className="flex items-center gap-1.5 text-on-surface-variant/70">
          <Cpu size={12} className="text-primary/70" />
          <span>
            {sysInfo.ram_total_mb > 0
              ? `${formatRam(sysInfo.ram_used_mb)} / ${formatRam(sysInfo.ram_total_mb)}`
              : "RAM …"}
          </span>
        </div>

        <span className="text-outline/40">•</span>

        {/* AI engine */}
        <div className="flex items-center gap-1.5 text-secondary">
          <Wifi size={12} className="text-secondary/70" />
          <span className="capitalize">{activeProvider} Engine</span>
        </div>
      </div>
    </footer>
  );
}
