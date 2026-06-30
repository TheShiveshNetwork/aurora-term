import React, { useContext } from "react";
import { SettingsContext, SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";

export default function EditorSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const fontFamily = draft.config.terminal.font_family;
  const fontSize = draft.config.terminal.font_size;
  const cursorStyle = draft.config.terminal.cursor_style;
  const cursorBlink = draft.config.terminal.cursor_blink;

  return (
    <div className="space-y-5">
      <SectionTitle>Editor</SectionTitle>

      {/* <div id="setting-font-family">
        <FieldRow label="Font Family">
          <input
            type="text"
            value={fontFamily}
            onChange={(e) => updateDraft((d) => { d.config.terminal.font_family = e.target.value; })}
            className="flex-1 bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-text select-text"
            style={{ color: "#E8EAF0" }}
          />
        </FieldRow>
      </div>

      <div id="setting-font-size">
        <FieldRow label="Font Size">
          <input
            type="number"
            value={fontSize}
            onChange={(e) => updateDraft((d) => { d.config.terminal.font_size = Number(e.target.value); })}
            min={10}
            max={32}
            className="w-20 bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-text select-text"
            style={{ color: "#E8EAF0" }}
          />
        </FieldRow>
      </div>

      <div id="setting-cursor-style">
        <FieldRow label="Cursor Style">
          <select
            value={cursorStyle}
            onChange={(e) => updateDraft((d) => { d.config.terminal.cursor_style = e.target.value; })}
            className="bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-pointer"
            style={{ color: "#E8EAF0", minWidth: "120px" }}
          >
            <option value="block">Block</option>
            <option value="underline">Underline</option>
            <option value="bar">Bar</option>
          </select>
        </FieldRow>
      </div>

      <div id="setting-cursor-blink">
        <FieldRow label="Cursor Blink">
          <ToggleSwitch checked={cursorBlink} onChange={(v) => updateDraft((d) => { d.config.terminal.cursor_blink = v; })} />
        </FieldRow>
      </div> */}

      <div id="setting-word-wrap">
        <FieldRow label="Word Wrap">
          <ToggleSwitch checked={draft.config.editor.word_wrap} onChange={(v) => updateDraft((d) => { d.config.editor.word_wrap = v; })} />
        </FieldRow>
      </div>

      <div id="setting-show-minimap">
        <FieldRow label="Show Minimap">
          <ToggleSwitch checked={draft.config.editor.show_minimap} onChange={(v) => updateDraft((d) => { d.config.editor.show_minimap = v; })} />
        </FieldRow>
      </div>
    </div>
  );
}
