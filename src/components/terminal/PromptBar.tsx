import { system } from "../../lib/ipc";

interface PromptBarProps {
  cwd: string;
  gitBranch?: string | null;
  gitDirty?: boolean;
  exitCode?: number;
}

export function PromptBar({ cwd, gitBranch, gitDirty, exitCode }: PromptBarProps) {
  // Gracefully shorten CWD, replacing typical user directories or path elements
  const shortCwd = (cwd || "~").replace(/^[a-zA-Z]:[\\/]Users[\\/][^\\/]+/, "~")
                                .replace(/^\/home\/[^/]+/, "~");

  const handleCwdClick = () => {
    system.revealInExplorer(cwd).catch((err) => {
      console.error("Failed to open path in explorer:", err);
    });
  };

  return (
    <div className="flex items-center gap-2 px-4 py-1 text-xs font-mono text-[var(--color-ui-text)] border-t border-[var(--color-ui-border)] bg-[var(--color-ui-surface)] select-none">
      {/* CWD trigger */}
      <button
        type="button"
        onClick={handleCwdClick}
        className="hover:text-primary transition-colors cursor-pointer flex items-center gap-1"
        title="Open in System Explorer"
      >
        <span>📂</span>
        <span className="font-semibold underline decoration-dashed decoration-outline-variant/35 underline-offset-2">
          {shortCwd || "~"}
        </span>
      </button>

      {/* Git branch info */}
      {gitBranch && (
        <>
          <span className="text-[var(--color-ui-muted)]/40 select-none">·</span>
          <span
            className={`flex items-center gap-1 font-semibold ${
              gitDirty ? "text-yellow-400" : "text-green-400"
            }`}
            title={gitDirty ? "Uncommitted changes present" : "Clean repository branch"}
          >
            <span>🌿</span>
            <span>
              {gitBranch}
              {gitDirty ? " *" : ""}
            </span>
          </span>
        </>
      )}

      {/* Exit code indicator (only displayed when error code non-zero) */}
      {exitCode !== undefined && exitCode !== 0 && (
        <span className="ml-auto flex items-center gap-1 text-red-400 font-bold bg-red-500/10 px-2 py-0.5 rounded border border-red-500/15 animate-pulse text-[10px] tracking-wider uppercase">
          <span>✕</span>
          <span>Exit {exitCode}</span>
        </span>
      )}
    </div>
  );
}
