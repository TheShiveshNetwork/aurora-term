import React from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { SectionTitle, FieldRow } from "./SettingsShared";

export default function EditorSettingsView() {
  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    cursorStyle, setCursorStyle,
    cursorBlink, setCursorBlink,
  } = useSettingsStore();

  return (
    <div className="space-y-5">
      <SectionTitle>Editor</SectionTitle>

      <div id="setting-font-family">
        <FieldRow label="Font Family">
          <input
            type="text"
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
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
            onChange={(e) => setFontSize(Number(e.target.value))}
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
            onChange={(e) => setCursorStyle(e.target.value as any)}
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
        <FieldRow label="Toggle Word Wrap">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={cursorBlink} onChange={() => setCursorBlink(!cursorBlink)} className="sr-only peer" />
            <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: cursorBlink ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${cursorBlink ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
            </div>
          </label>
        </FieldRow>
      </div>
    </div>
  );
}
