import React, { useContext } from "react";
import { SettingsContext, SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Button } from "../ui/Button";
import { useUpdateChecker } from "../../hooks/useUpdateChecker";
import { RefreshCw, ExternalLink, X } from "lucide-react";

export default function AboutSettingsView() {
  const context = useContext(SettingsContext);
  const draft = context?.draft;
  const updateDraft = context?.updateDraft;
  const updatesEnabled = draft?.config.updates?.enabled ?? true;

  const updateState = useUpdateChecker(updatesEnabled);

  return (
    <div className="space-y-5" id="setting-about">
      <SectionTitle>About</SectionTitle>
      <div className="space-y-2 text-[12px] text-on-surface/60">
        <p><span className="font-semibold text-on-surface">Aurora</span> — Hardware-accelerated, AI-native developer terminal.</p>
        <p>GPU-rendered blocks, multi-provider AI routing.</p>
        <p className="pt-2 text-on-surface/35">Built with Tauri v2, React, and Rust.</p>
      </div>

      <div id="setting-about-updates" className="space-y-3 pt-2">
        {updateState.info?.available && !updateState.info.dismissed ? (
          <div className="rounded-md px-3 py-2.5 space-y-2" style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.15)" }}>
            <div className="text-[12px] flex items-center gap-1.5" style={{ color: "#FF6B6B" }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#FF6B6B" }} />
              Aurora {updateState.info.latest_version} is available
              <span className="ml-auto text-[10px]" style={{ color: "rgba(232,234,240,0.4)" }}>v{updateState.info.current_version}</span>
            </div>
            <div className="flex gap-1.5">
              <Button variant="primary" size="sm" className="flex-1" onClick={updateState.openRelease}>
                <ExternalLink size={12} /> View on GitHub
              </Button>
              <Button variant="ghost" size="sm" onClick={updateState.dismiss} title="Dismiss this version">
                <X size={13} />
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={updateState.refresh} disabled={updateState.checking}>
            <RefreshCw size={12} className={updateState.checking ? "animate-spin" : ""} />
            {updateState.checking ? "Checking…" : "Check for updates"}
          </Button>
        )}
      </div>
    </div>
  );
}
