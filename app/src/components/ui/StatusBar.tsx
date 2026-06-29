import React, { useEffect, useRef, useState } from "react";
import { Cpu, GitBranch, Wifi, WifiOff, Copy, Folder } from "lucide-react";
import { useAIStore } from "../../stores/useAIStore";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { useShallow } from "zustand/react/shallow";
import { system } from "../../lib/ipc";
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
  const ref = useRef<HTMLDivElement>(null);
  const [offsetX, setOffsetX] = useState(0);

  useEffect(() => {
    if (!show || !ref.current) { setOffsetX(0); return; }
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    let ox = 0;
    if (rect.right > vw - 8) ox = vw - 8 - rect.right;
    if (rect.left < 8) ox = 8 - rect.left;
    setOffsetX(ox);
  }, [show, children]);

  return show ? (
    <div
      ref={ref}
      className={`absolute bottom-full left-1/2 mb-1.5 px-3 py-2 z-[100] whitespace-nowrap flex items-center gap-2 transition-opacity duration-150 ${className}`}
      style={{
        background: glassy,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
        transform: `translateX(calc(-50% + ${offsetX}px))`,
      }}
    >
      {children}
    </div>
  ) : null;
}

function CollapsibleFilePath({ filePath, cwd }: { filePath: string; cwd: string }) {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const fullPathRef = useRef<HTMLSpanElement>(null);

  // Normalize paths
  const normCwd = cwd.replace(/\\/g, "/");
  const normFile = filePath.replace(/\\/g, "/");
  
  let relativePath = normFile;
  if (normFile.startsWith(normCwd + "/")) {
    relativePath = normFile.substring(normCwd.length + 1);
  }

  const parts = relativePath.split("/");
  const filename = parts[parts.length - 1] || "";
  const subfolders = parts.slice(0, -1).join("/");

  useEffect(() => {
    const el = document.getElementById("aurora-status-bar");
    if (!el) return;

    const checkSize = () => {
      if (fullPathRef.current) {
        const fullWidth = fullPathRef.current.getBoundingClientRect().width;
        const shouldCollapse = fullWidth > 400 || window.innerWidth < 700;
        setIsOverflowing(shouldCollapse);
      }
    };

    const observer = new ResizeObserver(checkSize);
    observer.observe(el);

    checkSize(); // Initial check

    return () => {
      observer.disconnect();
    };
  }, [filePath, cwd]);

  return (
    <div className="inline-flex items-center" style={{ maxWidth: "400px" }}>
      {/* Hidden element to measure full path width */}
      <span
        ref={fullPathRef}
        className="absolute pointer-events-none opacity-0"
        style={{ whiteSpace: "nowrap", visibility: "hidden" }}
      >
        {relativePath}
      </span>

      {isOverflowing && subfolders ? (
        <span className="truncate flex items-center">
          <span className="opacity-40">...</span>
          <span className="opacity-25 mx-0.5">/</span>
          <span>{filename}</span>
        </span>
      ) : (
        <span className="truncate">
          {relativePath}
        </span>
      )}
    </div>
  );
}

export function StatusBar({ noFolder }: { noFolder?: boolean }) {
  const { activeProvider } = useAIStore();
  const { tabs, activeTabId } = useSessionStore();
  const { sessionCwds, projectDir, cwdAbsolute } = useAppShellStore(
    useShallow((s) => ({
      sessionCwds: s.sessionCwds,
      projectDir: s.projectDir,
      cwdAbsolute: s.cwdAbsolute,
    }))
  );
  const cwd = activeTabId ? (sessionCwds[activeTabId] || projectDir || cwdAbsolute) : (projectDir || cwdAbsolute);
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
    async function fetchRam() {
      try {
        const info = await system.getSystemInfo(cwdRef.current, false);
        setSysInfo((prev) => ({ ...prev, ram_used_mb: info.ram_used_mb, ram_total_mb: info.ram_total_mb }));
      } catch (_) { }
    }

    async function fetchGitBranch(cwd: string) {
      try {
        const info = await system.getCwdInfo(cwd);
        setSysInfo((prev) => ({ ...prev, git_branch: info.git_branch }));
      } catch (_) { }
    }

    if (cwdRef.current) {
      fetchGitBranch(cwdRef.current);
    }

    const handleCwdChange = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string; sessionId: string }>).detail;
      if (path) fetchGitBranch(path);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchRam();
      }
    };

    window.addEventListener("cwd-change", handleCwdChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (document.visibilityState === "visible") {
      fetchRam();
    }

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchRam();
      }
    }, 30000);

    return () => {
      window.removeEventListener("cwd-change", handleCwdChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
      if (cwdTooltipTimeoutRef.current) clearTimeout(cwdTooltipTimeoutRef.current);
    };
  }, [activeTabId]);

  return (
    <footer id="aurora-status-bar" className="flex justify-between items-center px-4 h-7 w-full z-50 select-none text-[11px] font-medium shrink-0"
      style={{
        background: "#0A0D14",
        borderTop: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* Left side */}
      <div className="flex items-center gap-4">
        {/* Git branch */}
        {sysInfo.git_branch && !noFolder && (
          <div
            className="relative flex items-center gap-1.5"
            style={{ color: "#3DDC84" }}
            onMouseEnter={() => setShowGitTooltip(true)}
            onMouseLeave={() => setShowGitTooltip(false)}
            onClick={() => {
              navigator.clipboard.writeText(sysInfo.git_branch || "");
              if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
            }}
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
        {cwd && !noFolder && (
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
                    className="relative cursor-pointer hover:underline flex items-center"
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
                    <CollapsibleFilePath filePath={activeFileTab.filePath || ""} cwd={cwd} />

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
