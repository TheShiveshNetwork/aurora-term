import React from "react";
import { SectionTitle } from "./SettingsShared";

export default function AboutSettingsView() {
  return (
    <div className="space-y-5" id="setting-about">
      <SectionTitle>About</SectionTitle>
      <div className="space-y-2 text-[12px] text-on-surface/60">
        <p><span className="font-semibold text-on-surface">Aurora</span> — Hardware-accelerated, AI-native developer terminal.</p>
        <p>GPU-rendered blocks, multi-provider AI routing.</p>
        <p className="pt-2 text-on-surface/35">Built with Tauri v2, React, and Rust.</p>
      </div>
    </div>
  );
}
