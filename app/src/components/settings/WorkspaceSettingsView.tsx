import React, { useContext } from "react";
import { SettingsContext, SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Button } from "../ui/Button";

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

      <div className="px-3 py-2.5 rounded-lg text-[11px] leading-normal bg-amber-500/5 border border-amber-500/18 text-amber-500/85">
        Specific workspace-level settings overrides are not yet implemented. All settings changed here will be saved to your global configuration.
      </div>

      <div id="setting-git-gui">
        <FieldRow label="Open Git GUI in">
          <div className="flex gap-1 p-0.5 rounded-sm bg-white/4">
            {GIT_GUI_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={gitGuiMode === opt.value ? "primary" : "ghost"}
                size="sm"
                onClick={() => updateDraft((d) => { d.config.editor.git_gui_mode = opt.value; })}
              >
                {opt.label}
              </Button>
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
