import React, { useEffect, useRef, useState } from "react";
import { Cpu, GitBranch, Wifi, WifiOff, Copy, Folder } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "../../stores/useAIStore";
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

const glassy = "rgba(19, 26, 36, 0.88)";

function Tooltip({ children, show, className = "" }: { children: React.ReactNode; show: boolean; className?: string }) {
  return show ? (
    <div
      className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-3 py-2 z-[100] whitespace-nowrap flex items-center gap-2 transition-opacity duration-150 ${className}`}
      style={{
        background: glassy,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
      }}
    >
      {children}
    </div>
  ) : null;
}

export function StatusBar({ cwd }: { cwd?: string }) {
  const { activeProvider } = useAIStore();
  const { tabs, activeTabId } = useSessionStore();
  const activeFileTab = tabs.find(t => t.id === activeTabId && t.type === "file");
  const [showPathTooltip, setShowPathTooltip] = useState(false);
  const [tooltipCopied, setTooltipCopied] = useState(false);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCwdTooltip, setShowCwdTooltip] = useState(false);
  const [cwdCopied, setCwdCopied] = useState(false);
  const cwdTooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showGitTooltip, setShowGitTooltip] = useState(false);
  const [showRamTooltip, setShowRamTooltip] = useState(false);
  const [showAiTooltip, setShowAiTooltip] = useState(false);
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
    <footer id="aurora-status-bar" className="flex justify-between items-center px-4 h-7 w-full z-50 select-none text-[11px] font-medium"
      style={{
        background: "#0A0D14",
        borderTop: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* Left side */}
      <div className="flex items-center gap-4">
        {/* Git branch */}
        {sysInfo.git_branch && (
          <div
            className="relative flex items-center gap-1.5"
            style={{ color: "#3DDC84" }}
            onMouseEnter={() => setShowGitTooltip(true)}
            onMouseLeave={() => setShowGitTooltip(false)}
          >
            <GitBranch size={11} style={{ color: "rgba(61,220,132,0.7)" }} />
            <span>{sysInfo.git_branch}</span>
            <Tooltip show={showGitTooltip}>
              <GitBranch size={11} style={{ color: "rgba(61,220,132,0.7)" }} />
              <span className="text-[10px]" style={{ color: "rgba(232,234,240,0.7)" }}>{sysInfo.git_branch}</span>
            </Tooltip>
          </div>
        )}

        {/* CWD and Active File */}
        {cwd && (
          <>
            {sysInfo.git_branch && <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>}
            <div className="flex items-center">
              <Folder size={11} className="shrink-0 mr-1" style={{ color: "rgba(232,234,240,0.4)" }} />

              <div
                className="relative cursor-pointer hover:underline"
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

                <Tooltip show={showCwdTooltip}>
                  <Folder size={11} style={{ color: "rgba(79,140,255,0.6)" }} />
                  <span className="text-[10px] max-w-[360px] truncate" style={{ color: "rgba(232,234,240,0.7)" }}>
                    {cwd}
                  </span>
                  {cwdCopied ? (
                    <span className="text-[9px] shrink-0" style={{ color: "#3DDC84" }}>Copied!</span>
                  ) : (
                    <Copy size={11} className="shrink-0" style={{ color: "rgba(232,234,240,0.35)" }} />
                  )}
                </Tooltip>
              </div>

              {activeFileTab && (
                <>
                  <span className="mx-0.5 select-none" style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
                  <div
                    className="relative cursor-pointer hover:underline"
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

                    <Tooltip show={showPathTooltip}>
                      <span className="text-[10px] max-w-[360px] truncate" style={{ color: "rgba(232,234,240,0.7)" }}>
                        {activeFileTab.filePath}
                      </span>
                      {tooltipCopied ? (
                        <span className="text-[9px] shrink-0" style={{ color: "#3DDC84" }}>Copied!</span>
                      ) : (
                        <Copy size={11} className="shrink-0" style={{ color: "rgba(232,234,240,0.35)" }} />
                      )}
                    </Tooltip>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* RAM usage */}
        <div
          className="relative flex items-center gap-1.5"
          onMouseEnter={() => setShowRamTooltip(true)}
          onMouseLeave={() => setShowRamTooltip(false)}
        >
          <Cpu size={11} style={{ color: "rgba(232,234,240,0.35)" }} />
          <span>
            {sysInfo.ram_total_mb > 0
              ? `${formatRam(sysInfo.ram_used_mb)} / ${formatRam(sysInfo.ram_total_mb)}`
              : "RAM …"}
          </span>
          <Tooltip show={showRamTooltip}>
            <Cpu size={11} style={{ color: "rgba(79,140,255,0.6)" }} />
            <span className="text-[10px]" style={{ color: "rgba(232,234,240,0.7)" }}>
              RAM: {formatRam(sysInfo.ram_used_mb)} used / {formatRam(sysInfo.ram_total_mb)} total
            </span>
          </Tooltip>
        </div>

        {/* AI connectivity */}
        <div
          className="relative flex items-center gap-1.5"
          onMouseEnter={() => setShowAiTooltip(true)}
          onMouseLeave={() => setShowAiTooltip(false)}
        >
          {activeProvider
            ? <Wifi size={11} style={{ color: "rgba(61,220,132,0.7)" }} />
            : <WifiOff size={11} style={{ color: "rgba(232,234,240,0.25)" }} />
          }
          <Tooltip show={showAiTooltip}>
            {activeProvider ? (
              <>
                <Wifi size={11} style={{ color: "rgba(61,220,132,0.7)" }} />
                <span className="text-[10px]" style={{ color: "rgba(232,234,240,0.7)" }}>
                  Connected — {activeProvider}
                </span>
              </>
            ) : (
              <>
                <WifiOff size={11} style={{ color: "rgba(232,234,240,0.35)" }} />
                <span className="text-[10px]" style={{ color: "rgba(232,234,240,0.5)" }}>
                  No provider configured
                </span>
              </>
            )}
          </Tooltip>
        </div>
      </div>
    </footer>
  );
}
