import React from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";

export default function WindowSettingsView() {
  const { compactUi, setCompactUi, showStatusbar, setShowStatusbar, blurSidebar, setBlurSidebar } = useSettingsStore();
  const { sidebarCollapsed, setSidebarCollapsed, showAiBar, setShowAiBar, chatInputOpen, setChatInputOpen, tabBarVisible, setTabBarVisible } = useAppShellStore();

  const toggle = (val: boolean, set: (v: boolean) => void) => () => set(!val);

  return (
    <div className="space-y-5">
      <SectionTitle>Window & Panels</SectionTitle>

      <div id="setting-sidebar">
        <FieldRow label="Show Sidebar">
          <ToggleSwitch checked={!sidebarCollapsed} onChange={(v) => setSidebarCollapsed(!v)} />
        </FieldRow>
      </div>

      <div id="setting-right-panel">
        <FieldRow label="Show Right Panel">
          <ToggleSwitch checked={showAiBar} onChange={setShowAiBar} />
        </FieldRow>
      </div>

      <div id="setting-command-input">
        <FieldRow label="Show Command Input">
          <ToggleSwitch checked={chatInputOpen} onChange={setChatInputOpen} />
        </FieldRow>
      </div>

      <div id="setting-tab-bar">
        <FieldRow label="Show Tab Bar">
          <ToggleSwitch checked={tabBarVisible} onChange={setTabBarVisible} />
        </FieldRow>
      </div>

      <div id="setting-blur-sidebar">
        <FieldRow label="Blur Sidebar">
          <ToggleSwitch checked={blurSidebar} onChange={setBlurSidebar} />
        </FieldRow>
      </div>

      <div id="setting-show-status-bar">
        <FieldRow label="Show Status Bar">
          <ToggleSwitch checked={showStatusbar} onChange={setShowStatusbar} />
        </FieldRow>
      </div>
    </div>
  );
}
