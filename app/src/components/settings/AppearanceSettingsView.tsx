import React from "react";
import { useSettingsStore, EditorThemeName } from "../../stores/useSettingsStore";
import { SectionTitle, FieldRow, THEME_OPTIONS } from "./SettingsShared";

export default function AppearanceSettingsView() {
  const { theme, setTheme, editorTheme, setEditorTheme } = useSettingsStore();

  return (
    <div className="space-y-5">
      <SectionTitle>Appearance</SectionTitle>

      <div id="setting-theme">
        <FieldRow label="Theme">
          <div className="flex gap-2">
            <button
              onClick={() => setTheme("dark")}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all cursor-pointer"
              style={{
                background: theme === "dark" ? "#4F8CFF" : "rgba(255,255,255,0.06)",
                color: theme === "dark" ? "#000" : "rgba(232,234,240,0.6)",
                border: theme === "dark" ? "none" : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Dark
            </button>
            <button
              onClick={() => setTheme("light")}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all cursor-pointer"
              style={{
                background: theme === "light" ? "#4F8CFF" : "rgba(255,255,255,0.06)",
                color: theme === "light" ? "#000" : "rgba(232,234,240,0.6)",
                border: theme === "light" ? "none" : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Light
            </button>
          </div>
        </FieldRow>
      </div>

      <div id="setting-editor-theme">
        <FieldRow label="Editor Theme">
          <select
            value={editorTheme}
            onChange={(e) => setEditorTheme(e.target.value as EditorThemeName)}
            className="bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-pointer select-none"
            style={{ color: "#E8EAF0", minWidth: "160px" }}
          >
            {THEME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </FieldRow>
      </div>
    </div>
  );
}
