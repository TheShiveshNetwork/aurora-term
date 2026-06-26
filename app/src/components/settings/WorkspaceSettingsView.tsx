import React from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { SectionTitle, FieldRow } from "./SettingsShared";

const GIT_GUI_OPTIONS = [
  { value: "tab", label: "New tab" },
  { value: "window", label: "New window" },
] as const;

export default function WorkspaceSettingsView() {
  const { gitGuiMode, setGitGuiMode } = useSettingsStore();

  return (
    <div className="space-y-5">
      <SectionTitle>Workspace</SectionTitle>

      <div id="setting-git-gui">
        <FieldRow label="Open Git GUI in">
          <div className="flex gap-1 p-0.5 rounded-sm backdrop-blur-md"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            {GIT_GUI_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGitGuiMode(opt.value)}
                className="px-3 py-1 text-[12px] font-medium rounded-sm transition-all cursor-pointer"
                style={{
                  background: gitGuiMode === opt.value ? "rgba(79,140,255,0.25)" : "transparent",
                  color: gitGuiMode === opt.value ? "#E8EAF0" : "rgba(232,234,240,0.5)",
                  border: gitGuiMode === opt.value ? "1px solid rgba(79,140,255,0.3)" : "1px solid transparent",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FieldRow>
      </div>
    </div>
  );
}
