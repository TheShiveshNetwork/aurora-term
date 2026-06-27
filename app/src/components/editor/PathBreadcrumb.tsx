import React from "react";

interface PathBreadcrumbProps {
  filePath: string;
  commitHash?: string;
  onOpenFile?: (filePath: string) => void;
}

export function PathBreadcrumb({ filePath, commitHash, onOpenFile }: PathBreadcrumbProps) {
  const parts = filePath.split("/");

  return (
    <div
      className="flex items-center gap-1 px-3 shrink-0 text-xs font-mono"
      style={{
        height: 34,
        background: "rgba(0,0,0,0.20)",
        borderBottom: "1px solid rgba(232,234,240,0.07)",
        color: "rgba(232,234,240,0.5)",
      }}
    >
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: "rgba(232,234,240,0.2)" }}>/</span>}
          <span
            className={i < parts.length - 1 && onOpenFile ? "cursor-pointer hover:text-[#E8EAF0]" : ""}
            onClick={() => {
              if (i < parts.length - 1 && onOpenFile) {
                onOpenFile(parts.slice(0, i + 1).join("/"));
              }
            }}
          >
            {part}
          </span>
        </React.Fragment>
      ))}
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
