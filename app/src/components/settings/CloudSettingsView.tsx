import React, { useContext, useEffect, useState } from "react";
import { SettingsContext, SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Button } from "../ui/Button";
import { cloud } from "../../lib/cloud";
import { config, AuthStatus } from "../../lib/ipc";
import { applyAppConfig } from "../../hooks/useAppBootstrap";
import { CloudDownload, CloudUpload, Check } from "lucide-react";

export default function CloudSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const updatesEnabled = draft.config.updates?.enabled ?? true;

  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<{ exists: boolean; inSync: boolean } | null>(null);

  const refreshSync = async () => {
    try {
      const cfg = await config.get();
      setSync(await cloud.settingsSyncState(cfg));
    } catch {
      setSync(null);
    }
  };

  const refreshAuth = () => {
    cloud.authStatus().then((a) => {
      setAuth(a);
      if (a.signed_in) void refreshSync();
      else setSync(null);
    }).catch(() => {});
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  useEffect(() => cloud.onAuthChange(refreshAuth), [refreshAuth]);

  // Upload the current settings to the cloud (manual).
  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      const cfg = await config.get();
      await cloud.uploadSettings(cfg);
      setSync({ exists: true, inSync: true });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // Download the cloud settings and apply them (manual).
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const remote = await cloud.downloadSettings();
      if (!remote) {
        setError("No settings saved in the cloud yet.");
        return;
      }
      if (remote.payload) {
        await config.saveGlobal(remote.payload as any);
        applyAppConfig(remote.payload as any);
      }
      setSync({ exists: true, inSync: true });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = !!auth?.signed_in;

  return (
    <div className="space-y-5">
      <SectionTitle>Cloud</SectionTitle>

      <div id="setting-cloud-sync">
        <FieldRow label="Sync">
          {sync?.inSync && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "rgba(90,200,150,0.7)" }}>
              <Check size={14} />
              Up to date with the cloud
            </div>
          )}
        </FieldRow>
        <div className="text-[11px] my-2" style={{ color: "rgba(232,234,240,0.3)" }}>
          Upload your settings to the cloud, or install the settings saved in the cloud
        </div>
        <div className="flex flex-col mt-2 gap-1">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={busy || !signedIn || (sync?.inSync ?? false)} onClick={upload}>
              <CloudUpload size={12} /> Upload
            </Button>
            <Button variant="secondary" size="sm" disabled={busy || !signedIn || !sync?.exists || (sync?.inSync ?? false)} onClick={download}>
              <CloudDownload size={12} /> Download
            </Button>
          </div>
          {!signedIn && (
            <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.3)" }}>
              Sign in to sync settings
            </span>
          )}
        </div>
      </div>

      <div id="setting-updates-enabled">
        <FieldRow label="Check for Updates" description="Notify when a new Aurora release is published on GitHub">
          <ToggleSwitch checked={updatesEnabled} onChange={(v) => updateDraft((d) => { d.config.updates.enabled = v; })} />
        </FieldRow>
      </div>

      {error && (
        <div className="px-2.5 py-1.5 text-[11px] rounded-md" style={{ color: "#FF6B6B", background: "rgba(255,107,107,0.08)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
