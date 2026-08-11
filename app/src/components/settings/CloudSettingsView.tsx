import React, { useContext, useEffect, useState } from "react";
import { SettingsContext, SectionTitle, FieldRow } from "./SettingsShared";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Button } from "../ui/Button";
import { cloud, AuthStatus } from "../../lib/ipc";

export default function CloudSettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const apiBaseUrl = draft.config.cloud?.api_base_url ?? "";
  const autoSync = draft.config.cloud?.auto_sync ?? false;
  const updatesEnabled = draft.config.updates?.enabled ?? true;
  const intervalHours = draft.config.updates?.check_interval_hours ?? 24;

  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cloud.authStatus().then(setAuth).catch(() => {});
  }, []);

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await cloud.signOut();
      setAuth({ signed_in: false, email: null });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionTitle>Cloud Sync & Updates</SectionTitle>

      <div id="setting-cloud-api-base-url">
        <FieldRow label="API Base URL" description="Aurora backend (Supabase Edge Function). Empty disables sync and update checks.">
          <input
            type="text"
            placeholder="https://…"
            value={apiBaseUrl}
            onChange={(e) => updateDraft((d) => { d.config.cloud.api_base_url = e.target.value; })}
            className="w-56 px-2.5 py-1.5 text-[12px] rounded-md outline-none text-right"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#E8EAF0" }}
          />
        </FieldRow>
      </div>

      <div id="setting-cloud-auto-sync">
        <FieldRow label="Auto Sync" description="Push/pull aurora.json after signing in and on a schedule">
          <ToggleSwitch checked={autoSync} onChange={(v) => updateDraft((d) => { d.config.cloud.auto_sync = v; })} />
        </FieldRow>
      </div>

      <div id="setting-updates-enabled">
        <FieldRow label="Check for Updates" description="Notify when a new Aurora release is published on GitHub">
          <ToggleSwitch checked={updatesEnabled} onChange={(v) => updateDraft((d) => { d.config.updates.enabled = v; })} />
        </FieldRow>
      </div>

      <div id="setting-updates-interval">
        <FieldRow label="Check Interval (hours)" description="How often to poll for releases">
          <input
            type="number"
            min={1}
            value={intervalHours}
            onChange={(e) => updateDraft((d) => { d.config.updates.check_interval_hours = Math.max(1, Number(e.target.value) || 24); })}
            className="w-20 px-2.5 py-1.5 text-[12px] rounded-md outline-none text-right"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#E8EAF0" }}
          />
        </FieldRow>
      </div>

      <div id="setting-cloud-account">
        <FieldRow label="Account" description={auth?.signed_in ? auth.email ?? "Signed in" : "Not signed in"}>
          {auth?.signed_in ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={signOut}>Sign out</Button>
          ) : (
            <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.3)" }}>Sign in from the header avatar</span>
          )}
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
