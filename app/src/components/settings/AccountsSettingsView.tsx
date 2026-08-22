import React, { useEffect, useState } from "react";
import { SectionTitle, FieldRow } from "./SettingsShared";
import { Button } from "../ui/Button";
import { cloud, onAuthChange } from "../../lib/cloud";
import { AuthStatus } from "../../lib/ipc";
import { Github, User } from "lucide-react";

export default function AccountsSettingsView() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAuth = () => {
    cloud.authStatus().then(setAuth).catch(() => {});
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  // Re-check when sign-in completes via the deep link (same event the header uses).
  useEffect(() => cloud.onAuthChange(refreshAuth), [refreshAuth]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await cloud.signInOAuth("github");
      setAuth(status);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await cloud.signOut();
      setAuth({ signed_in: false, email: null, username: null });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = !!auth?.signed_in;

  return (
    <div id="setting-account" className="space-y-5">
      <SectionTitle>Account</SectionTitle>

      {signedIn ? (
        <>
          <div id="setting-account-profile" className="flex items-center gap-3 px-1 py-1">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "rgba(90,200,150,0.14)", color: "#5AC896" }}
            >
              <User size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate" style={{ color: "#E8EAF0" }}>
                {auth?.username ?? auth?.email ?? "Signed in"}
              </div>
              <div className="text-[11px] truncate" style={{ color: "rgba(232,234,240,0.35)" }}>
                {auth?.email ?? ""}
              </div>
            </div>
          </div>

          <div id="setting-account-username">
            <FieldRow label="Username">
              <span className="text-[12px]" style={{ color: "#E8EAF0" }}>{auth?.username ?? "—"}</span>
            </FieldRow>
          </div>

          <div id="setting-account-email">
            <FieldRow label="Email" description="The account used to sync your settings">
              <span className="text-[12px]" style={{ color: "#E8EAF0" }}>{auth?.email ?? "—"}</span>
            </FieldRow>
          </div>

          <div id="setting-account-signout">
            <FieldRow label="Sign out" description="Sign out of your Aurora account on this device">
              <Button variant="secondary" size="sm" disabled={busy} onClick={signOut}>
                Sign out
              </Button>
            </FieldRow>
          </div>
        </>
      ) : (
        <div id="setting-account-signin" className="space-y-2">
          <p className="text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>
            Sign in with GitHub to sync your Aurora settings across devices.
          </p>
          <Button
            variant="secondary"
            size="md"
            className="w-full"
            disabled={busy}
            onClick={signIn}
          >
            <Github size={13} /> Continue with GitHub
          </Button>
        </div>
      )}

      {error && (
        <div className="px-2.5 py-1.5 text-[11px] rounded-md" style={{ color: "#FF6B6B", background: "rgba(255,107,107,0.08)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
