import React, { useContext } from "react";
import { SettingsContext, SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@/components/reui/number-field";

export default function EditorSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const fontFamily = draft.config.terminal.font_family;
  const fontSize = draft.config.terminal.font_size;
  const cursorStyle = draft.config.terminal.cursor_style;
  const cursorBlink = draft.config.terminal.cursor_blink;
  const editorFontSize = draft.config.editor.font_size;

  return (
    <div className="space-y-5">
      <SectionTitle>Editor</SectionTitle>

      <div id="setting-editor-font-size">
        <FieldRow label="Editor Font Size" description="Font size for the file editor (CodeMirror).">
          <NumberField
            value={editorFontSize}
            min={8}
            max={48}
            step={1}
            size="sm"
            onValueChange={(v) => {
              if (typeof v === "number" && Number.isFinite(v)) {
                const clamped = Math.max(8, Math.min(48, Math.round(v)));
                updateDraft((d) => { d.config.editor.font_size = clamped; });
              }
            }}
          >
            <NumberFieldGroup className="w-10 rounded-sm">
              <NumberFieldDecrement className="rounded-s-sm" />
              <NumberFieldInput />
              <NumberFieldIncrement className="rounded-e-sm" />
            </NumberFieldGroup>
          </NumberField>
        </FieldRow>
      </div>

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

      <div id="setting-ai-live-suggestions">
        <FieldRow label="AI Live Suggestions" description="Show AI ghost-text suggestions while typing in the file view">
          <ToggleSwitch checked={draft.config.editor.ai_live_suggestions} onChange={(v) => updateDraft((d) => { d.config.editor.ai_live_suggestions = v; })} />
        </FieldRow>
      </div>

      <div id="setting-indent-markers">
        <FieldRow label="Indent Markers">
          <ToggleSwitch checked={draft.config.editor.indent_markers} onChange={(v) => updateDraft((d) => { d.config.editor.indent_markers = v; })} />
        </FieldRow>
      </div>

      <div id="setting-lsp-enabled">
        <FieldRow label="Language Server (LSP)" description="Download and run language servers on demand for diagnostics, completions, and hover">
          <ToggleSwitch checked={draft.config.editor.lsp_enabled} onChange={(v) => updateDraft((d) => { d.config.editor.lsp_enabled = v; })} />
        </FieldRow>
      </div>
    </div>
  );
}
