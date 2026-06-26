import React from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { SectionTitle, FieldRow } from "./SettingsShared";

export default function WindowSettingsView() {
  const { compactUi, setCompactUi, showStatusbar, setShowStatusbar, blurSidebar, setBlurSidebar } = useSettingsStore();
  const { sidebarCollapsed, setSidebarCollapsed, showAiBar, setShowAiBar, chatInputOpen, setChatInputOpen, tabBarVisible, setTabBarVisible } = useAppShellStore();

  const toggle = (val: boolean, set: (v: boolean) => void) => () => set(!val);

  return (
    <div className="space-y-5">
      <SectionTitle>Window & Panels</SectionTitle>

      <div id="setting-sidebar">
        <FieldRow label="Show Sidebar">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={!sidebarCollapsed} onChange={toggle(sidebarCollapsed, setSidebarCollapsed)} className="sr-only peer" />
            <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: !sidebarCollapsed ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${!sidebarCollapsed ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
            </div>
          </label>
        </FieldRow>
      </div>

      <div id="setting-right-panel">
        <FieldRow label="Show Right Panel">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={showAiBar} onChange={toggle(showAiBar, setShowAiBar)} className="sr-only peer" />
            <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: showAiBar ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${showAiBar ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
            </div>
          </label>
        </FieldRow>
      </div>

      <div id="setting-command-input">
        <FieldRow label="Show Command Input">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={chatInputOpen} onChange={toggle(chatInputOpen, setChatInputOpen)} className="sr-only peer" />
            <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: chatInputOpen ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${chatInputOpen ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
            </div>
          </label>
        </FieldRow>
      </div>

      <div id="setting-tab-bar">
        <FieldRow label="Show Tab Bar">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={tabBarVisible} onChange={toggle(tabBarVisible, setTabBarVisible)} className="sr-only peer" />
            <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: tabBarVisible ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${tabBarVisible ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
            </div>
          </label>
        </FieldRow>
      </div>

      <div id="setting-blur-sidebar">
        <FieldRow label="Blur Sidebar">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={blurSidebar} onChange={toggle(blurSidebar, setBlurSidebar)} className="sr-only peer" />
            <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: blurSidebar ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${blurSidebar ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
            </div>
          </label>
        </FieldRow>
      </div>

      <div id="setting-show-status-bar">
        <FieldRow label="Show Status Bar">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={showStatusbar} onChange={toggle(showStatusbar, setShowStatusbar)} className="sr-only peer" />
            <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: showStatusbar ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${showStatusbar ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
            </div>
          </label>
        </FieldRow>
      </div>
    </div>
  );
}
