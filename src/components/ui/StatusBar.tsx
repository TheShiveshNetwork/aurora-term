import React, { useEffect, useState } from "react";
import { Cpu, GitBranch, Wifi } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "../../stores/useAIStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

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

export function StatusBar() {
  const { activeProvider } = useAIStore();
  const { mode } = useSettingsStore();
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
    <footer className="flex justify-between items-center px-4 h-7 w-full bg-surface-container-lowest border-t border-outline-variant/5 z-50 select-none text-[10px] font-code-sm font-medium">
      {/* Left side */}
      <div className="flex items-center gap-4">
        {/* Git branch */}
        {sysInfo.git_branch && (
          <div className="flex items-center gap-1.5 text-on-surface-variant/70">
            <GitBranch size={10} className="text-tertiary/70" />
            <span className="text-tertiary">{sysInfo.git_branch}</span>
          </div>
        )}

        {/* Mode pill */}
        <div className="flex items-center gap-1.5 text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-container shadow-[0_0_4px_#00f0ff] animate-pulse" />
          <span className="uppercase text-[9px] tracking-wide">{mode} MODE</span>
        </div>
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

        <span className="text-outline/40">•</span>

        {/* Encoding */}
        <span className="text-on-surface-variant/60 font-mono uppercase tracking-wider">
          {sysInfo.encoding}
        </span>
      </div>
    </footer>
  );
}
