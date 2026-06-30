import React, { useContext } from "react";
import { SettingsContext, SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";

export default function WindowSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const sidebarCollapsed = draft.sidebarCollapsed;
  const showAiBar = draft.showAiBar;
  const chatInputOpen = draft.chatInputOpen;
  const tabBarVisible = draft.tabBarVisible;
  // const blurSidebar = draft.config.appearance.blur_sidebar;
  const showStatusbar = draft.config.appearance.show_statusbar;

  return (
    <div className="space-y-5">
      <SectionTitle>Window & Panels</SectionTitle>

      <div id="setting-sidebar">
        <FieldRow label="Show Sidebar">
          <ToggleSwitch checked={!sidebarCollapsed} onChange={(v) => updateDraft(d => { d.sidebarCollapsed = !v; })} />
        </FieldRow>
      </div>

      <div id="setting-right-panel">
        <FieldRow label="Show Right Panel">
          <ToggleSwitch checked={showAiBar} onChange={(v) => updateDraft(d => { d.showAiBar = v; })} />
        </FieldRow>
      </div>

      <div id="setting-command-input">
        <FieldRow label="Show Command Input">
          <ToggleSwitch checked={chatInputOpen} onChange={(v) => updateDraft(d => { d.chatInputOpen = v; })} />
        </FieldRow>
      </div>

      <div id="setting-tab-bar">
        <FieldRow label="Show Tab Bar">
          <ToggleSwitch checked={tabBarVisible} onChange={(v) => updateDraft(d => { d.tabBarVisible = v; })} />
        </FieldRow>
      </div>

      {/* <div id="setting-blur-sidebar">
        <FieldRow label="Blur Sidebar">
          <ToggleSwitch checked={blurSidebar} onChange={(v) => updateDraft(d => { d.config.appearance.blur_sidebar = v; })} />
        </FieldRow>
      </div> */}

      <div id="setting-show-status-bar">
        <FieldRow label="Show Status Bar">
          <ToggleSwitch checked={showStatusbar} onChange={(v) => updateDraft(d => { d.config.appearance.show_statusbar = v; })} />
        </FieldRow>
      </div>
    </div>
  );
}
