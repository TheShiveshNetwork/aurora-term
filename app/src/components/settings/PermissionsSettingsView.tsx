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
          label="Require review for terminal commands"
          description="Prompt for approval before executing any command planned by the agent."
        >
          <ToggleSwitch
            checked={!!draft.config.ai.require_review_for_commands}
            onChange={(v) => updateDraft((d) => { d.config.ai.require_review_for_commands = v; })}
          />
        </FieldRow>

        <FieldRow
          label="Require review for file changes"
          description="Prompt for approval before writing or modifying any files in the workspace."
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
