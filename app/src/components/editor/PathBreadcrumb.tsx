import React from "react";

interface PathBreadcrumbProps {
  filePath: string;
  commitHash?: string;
  onOpenFile?: (filePath: string) => void;
}

export function PathBreadcrumb({ filePath, commitHash, onOpenFile }: PathBreadcrumbProps) {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  return (
    <div className="flex items-center px-3 shrink-0 text-xs font-mono">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-on-surface-variant/40">/</span>}
            <span
              className={isLast && onOpenFile ? "cursor-pointer hover:text-[#E8EAF0] hover:underline" : ""}
              style={!isLast ? { color: "rgba(232,234,240,0.45)" } : undefined}
              onClick={isLast ? () => onOpenFile?.(normalized) : undefined}
            >
              {part}
            </span>
          </React.Fragment>
        );
      })}
      {commitHash && (
        <span
          className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: "rgba(79,140,255,0.15)", color: "#4F8CFF" }}
        >
          {commitHash.slice(0, 7)}
        </span>
      )}
    </div>
  );
}
