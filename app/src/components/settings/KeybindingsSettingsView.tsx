import React, { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { SettingsContext, SectionTitle } from "./SettingsShared";
import { Pencil, RotateCcw, Search, X } from "lucide-react";
import { DEFAULT_KEYBINDINGS, KeybindingDef } from "../../stores/useSettingsStore";

export default function KeybindingsSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const keybindingOverrides = draft.config.keybindings.overrides;

  const setKeybindingOverride = (id: string, keys: string) => {
    updateDraft((d) => {
      d.config.keybindings.overrides[id] = keys;
    });
  };

  const resetKeybindingOverride = (id: string) => {
    updateDraft((d) => {
      delete d.config.keybindings.overrides[id];
    });
  };

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const hasMod = e.ctrlKey || e.metaKey;
    const hasShift = e.shiftKey;
    const hasAlt = e.altKey;

    if (hasMod || hasShift || hasAlt) {
      if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") return;
      if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab") return;

      e.preventDefault();

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");

      let key = e.key;
      if (key === " ") key = "Space";
      else if (key.length === 1) key = key.toUpperCase();
      else if (key === "ArrowUp") key = "Up";
      else if (key === "ArrowDown") key = "Down";
      else if (key === "ArrowLeft") key = "Left";
      else if (key === "ArrowRight") key = "Right";
      else key = key.charAt(0).toUpperCase() + key.slice(1);

      parts.push(key);
      setSearch(parts.join("+"));
    }
  }, []);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return DEFAULT_KEYBINDINGS;
    return DEFAULT_KEYBINDINGS.filter((kb) => {
      const keys = keybindingOverrides[kb.id] || kb.keys;
      return (
        kb.command.toLowerCase().includes(q) ||
        keys.toLowerCase().includes(q) ||
        kb.when.toLowerCase().includes(q)
      );
    });
  }, [debouncedSearch, keybindingOverrides]);

  const getKeys = useCallback(
    (kb: KeybindingDef) => keybindingOverrides[kb.id] || kb.keys,
    [keybindingOverrides],
  );

  const getSource = useCallback(
    (kb: KeybindingDef) =>
      keybindingOverrides[kb.id] ? ("changed" as const) : ("system" as const),
    [keybindingOverrides],
  );

  const editingKb = editingId
    ? DEFAULT_KEYBINDINGS.find((k) => k.id === editingId)!
    : null;

  return (
    <div className="space-y-4" id="setting-keybindings">
      <SectionTitle>Keybindings</SectionTitle>

      <div className="relative">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface/30"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search keybindings by command, shortcut, or context..."
          className="w-full text-[13px] pl-8 pr-8 py-2 rounded-lg outline-none transition-colors bg-white/3 border border-white/7 text-on-surface"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 transition-colors text-on-surface/35"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="rounded-lg overflow-hidden border border-white/6">
        <div className="flex items-center text-[11px] font-semibold uppercase tracking-wider px-3 py-2 select-none bg-white/3 text-on-surface/35 border-b border-white/6">
          <div className="w-7 shrink-0" />
          <div className="flex-1 min-w-0">Command</div>
          <div className="w-[140px] shrink-0 text-left">Keybinding</div>
          <div className="w-[90px] shrink-0 text-left">When</div>
          <div className="w-[72px] shrink-0 text-left">Source</div>
        </div>

        <div className="max-h-[420px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[12px] text-on-surface/30">
              No keybindings match your search
            </div>
          ) : (
            filtered.map((kb) => {
              const keys = getKeys(kb);
              const source = getSource(kb);
              return (
                <div key={kb.id} className="flex items-center text-[12px] px-3 py-2 group transition-colors border-b border-white/4">
                  <button
                    onClick={() => setEditingId(kb.id)}
                    className="w-6 shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-100 focus:opacity-100 mr-1 rounded text-on-surface/35"
                    title="Edit keybinding"
                  >
                    <Pencil size={11} />
                  </button>

                  <div className="flex-1 min-w-0 truncate text-on-surface">
                    {kb.command}
                  </div>

                  <div className="w-[140px] shrink-0 flex justify-start">
                    <kbd className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-primary/10 text-primary border border-primary/15">
                      {keys}
                    </kbd>
                  </div>

                  <div className="w-[90px] shrink-0 text-left text-[11px] text-on-surface/40">
                    {kb.when}
                  </div>

                  <div className="w-[72px] shrink-0 flex justify-start">
                    {source === "changed" ? (
                      <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-[rgba(255,183,77,0.1)] text-[#FFB74D]">
                        Changed
                      </span>
                    ) : (
                      <span className="text-[11px] text-on-surface/25">
                        System
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {editingKb && (
        <KeyCaptureModal
          label={editingKb.command}
          currentKeys={getKeys(editingKb)}
          defaultKeys={editingKb.keys}
          onSave={(keys) => {
            setKeybindingOverride(editingKb.id, keys);
            setEditingId(null);
          }}
          onReset={() => {
            resetKeybindingOverride(editingKb.id);
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function KeyCaptureModal({
  label,
  currentKeys,
  defaultKeys,
  onSave,
  onReset,
  onClose,
}: {
  label: string;
  currentKeys: string;
  defaultKeys: string;
  onSave: (keys: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [capturedKeys, setCapturedKeys] = useState(currentKeys);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    captureRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Enter") {
        onSave(capturedKeys);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");

      let key = e.key;
      if (key === " ") key = "Space";
      else if (key.length === 1) key = key.toUpperCase();
      else if (key === "ArrowUp") key = "Up";
      else if (key === "ArrowDown") key = "Down";
      else if (key === "ArrowLeft") key = "Left";
      else if (key === "ArrowRight") key = "Right";
      else if (key === "Escape" || key === "Enter") return;
      else key = key.charAt(0).toUpperCase() + key.slice(1);

      parts.push(key);
      setCapturedKeys(parts.join("+"));
    },
    [onClose, onSave, capturedKeys],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="rounded-xl p-5 w-[360px] shadow-2xl bg-surface-container border border-white/8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
            Keybinding
          </span>
          <span className="text-[13px] font-semibold truncate text-on-surface">
            {label}
          </span>
        </div>

        <div
          ref={captureRef}
          tabIndex={0}
          className="flex items-center justify-center h-12 rounded-lg mb-2 cursor-text select-none outline-none transition-colors bg-white/3 border border-primary/30"
          onKeyDown={handleKeyDown}
        >
          <span className="text-[14px] font-mono tracking-wide text-primary">
            {capturedKeys}
          </span>
        </div>

        <p className="text-[11px] mb-4 text-on-surface/35">
          Press the desired key combination, then press Enter or click Save.
        </p>

        <div className="flex items-center justify-end gap-2">
          {currentKeys !== defaultKeys && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 px-3 py-1.5 text-[12px] rounded-lg transition-colors hover:bg-white/5 text-on-surface/50"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] rounded-lg transition-colors hover:bg-white/8 text-on-surface/60 bg-white/6"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(capturedKeys)}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors bg-primary text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
