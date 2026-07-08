import { useState, useEffect, useMemo, useCallback } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { GitBranch, Search, Check } from "lucide-react";
import type { GitBranchInfo } from "../../lib/ipc";

interface BranchCheckoutDialogProps {
  open: boolean;
  branches: GitBranchInfo[];
  currentBranch?: string;
  onCheckout: (branch: string) => void;
  onCancel: () => void;
}

export function BranchCheckoutDialog({
  open, branches, currentBranch, onCheckout, onCancel,
}: BranchCheckoutDialogProps) {
  const [filter, setFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setFilter("");
      setSelectedIdx(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return branches;
    return branches.filter(b => b.name.toLowerCase().includes(q));
  }, [branches, filter]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && filtered[selectedIdx]) { onCheckout(filtered[selectedIdx].name); }
  }, [filtered, selectedIdx, onCheckout]);

  return (
    <Modal open={open} onClose={onCancel} title="Checkout Branch" width="480px">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors" style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}>
          <Search size={14} style={{ color: "rgba(232,234,240,0.3)", flexShrink: 0 }} />
          <input
            value={filter}
            onChange={e => { setFilter(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search branches..."
            className="flex-1 bg-transparent text-sm outline-none border-none"
            style={{ color: "#E8EAF0" }}
            autoFocus
          />
        </div>
        <div className="flex flex-col max-h-64 overflow-y-auto gap-0.5" style={{ minHeight: 120 }}>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs" style={{ color: "rgba(232,234,240,0.3)" }}>No branches found</div>
          ) : (
            filtered.map((b, i) => {
              const isRemote = b.name.startsWith("remotes/");
              const displayName = isRemote ? b.name.replace("remotes/", "") : b.name;
              const isCurrent = b.current;
              const isSelected = i === selectedIdx;
              return (
                <button
                  key={b.name}
                  onClick={() => onCheckout(b.name)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer"
                  style={{
                    background: isCurrent ? "rgba(79,140,255,0.08)" : isSelected ? "rgba(79,140,255,0.12)" : "transparent",
                    color: isCurrent ? "#4F8CFF" : "rgba(232,234,240,0.75)",
                  }}
                >
                  <GitBranch size={13} style={{ color: isCurrent ? "#4F8CFF" : isRemote ? "rgba(232,234,240,0.25)" : "rgba(232,234,240,0.4)", flexShrink: 0 }} />
                  <span className="truncate flex-1">{displayName}</span>
                  {isCurrent && <Check size={12} style={{ color: "#4F8CFF", flexShrink: 0 }} />}
                  {isRemote && <span className="text-[10px] uppercase" style={{ color: "rgba(232,234,240,0.25)", flexShrink: 0 }}>remote</span>}
                </button>
              );
            })
          )}
        </div>
        <div className="flex justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
