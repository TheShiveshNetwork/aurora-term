import React, { useContext } from "react";
import { SettingsContext, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";

export default function PermissionsSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  return (
    <div className="space-y-6 text-sm" id="setting-permissions">
      <div>
        <h2 className="text-xl font-semibold text-white tracking-tight">Permissions</h2>
        <p className="text-xs text-white/40 mt-1">Control what the agent can do without asking for approval.</p>
      </div>

      <div className="space-y-3 pt-2">
        <FieldRow
          label="Require review for terminal view"
          description="In a terminal tab, prompt for approval before the agent runs any tool (commands, or file edits made from the terminal)."
        >
          <ToggleSwitch
            checked={!!draft.config.ai.require_review_for_commands}
            onChange={(v) => updateDraft((d) => { d.config.ai.require_review_for_commands = v; })}
          />
        </FieldRow>

        <FieldRow
          label="Require review for file view"
          description="In a file, diff, git, merge or agent view, prompt for approval before the agent runs any tool (file writes/patches, or commands)."
        >
          <ToggleSwitch
            checked={!!draft.config.ai.require_review_for_writes}
            onChange={(v) => updateDraft((d) => { d.config.ai.require_review_for_writes = v; })}
          />
        </FieldRow>
      </div>
    </div>
  );
}
