import React, { useContext, useMemo } from "react";
import { SettingsContext, SectionTitle, FieldRow, THEME_OPTIONS } from "./SettingsShared";
import { EditorThemeName } from "../../stores/useSettingsStore";
import { Button } from "../ui/Button";
import { SearchableSelect } from "../ui/SearchableSelect";

export default function AppearanceSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const theme = draft.config.terminal.theme;
  const editorTheme = draft.config.editor.theme as EditorThemeName;

  const themeOptions = useMemo(() => THEME_OPTIONS.map((o) => ({ id: o.value, label: o.label })), []);

  return (
    <div className="space-y-5">
      <SectionTitle>Appearance</SectionTitle>

      <div id="setting-theme">
        <FieldRow label="Theme">
          <div className="flex gap-2">
            <Button
              variant={theme === "dark" ? "primary" : "secondary"}
              size="sm"
              onClick={() => updateDraft((d) => { d.config.terminal.theme = "dark"; })}
            >
              Dark
            </Button>
            <Button
              variant={theme === "light" ? "primary" : "secondary"}
              size="sm"
              onClick={() => updateDraft((d) => { d.config.terminal.theme = "light"; })}
            >
              Light
            </Button>
          </div>
        </FieldRow>
      </div>

      <div id="setting-editor-theme">
        <FieldRow label="Editor Theme">
          <SearchableSelect
            value={editorTheme}
            options={themeOptions}
            onChange={(val) => updateDraft((d) => { d.config.editor.theme = val as EditorThemeName; })}
            placeholder="Select theme"
            className="w-[200px]"
          />
        </FieldRow>
      </div>
    </div>
  );
}
