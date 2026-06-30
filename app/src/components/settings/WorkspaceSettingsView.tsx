import React, { useContext } from "react";
import { SettingsContext, SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";

const GIT_GUI_OPTIONS = [
  { value: "tab", label: "New tab" },
  { value: "window", label: "New window" },
] as const;

export default function WorkspaceSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const gitGuiMode = draft.config.editor.git_gui_mode;
  const restoreTabs = draft.config.terminal.restore_tabs;

  return (
    <div className="space-y-5">
      <SectionTitle>Workspace</SectionTitle>

      <div
        className="px-3 py-2.5 rounded-lg text-[11px] leading-normal"
        style={{ background: "rgba(255, 180, 84, 0.05)", border: "1px solid rgba(255, 180, 84, 0.18)", color: "rgba(255, 180, 84, 0.85)" }}
      >
        Specific workspace-level settings overrides are not yet implemented. All settings changed here will be saved to your global configuration.
      </div>

      <div id="setting-git-gui">
        <FieldRow label="Open Git GUI in">
          <div className="flex gap-1 p-0.5 rounded-sm backdrop-blur-md"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            {GIT_GUI_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateDraft((d) => { d.config.editor.git_gui_mode = opt.value; })}
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

      <div id="setting-restore-tabs">
        <FieldRow label="Keep opened tabs on startup">
          <ToggleSwitch checked={restoreTabs} onChange={(v) => updateDraft((d) => { d.config.terminal.restore_tabs = v; })} />
        </FieldRow>
      </div>
    </div>
  );
}
