import React from "react";
import { SectionTitle } from "./SettingsShared";

export default function AboutSettingsView() {
  return (
    <div className="space-y-5" id="setting-about">
      <SectionTitle>About</SectionTitle>
      <div className="space-y-2 text-[12px]" style={{ color: "rgba(232,234,240,0.6)" }}>
        <p><span className="font-semibold" style={{ color: "#E8EAF0" }}>Aurora</span> — Hardware-accelerated, AI-native developer terminal.</p>
        <p>GPU-rendered blocks, multi-provider AI routing.</p>
        <p className="pt-2" style={{ color: "rgba(232,234,240,0.35)" }}>Built with Tauri v2, React, and Rust.</p>
      </div>
    </div>
  );
}
