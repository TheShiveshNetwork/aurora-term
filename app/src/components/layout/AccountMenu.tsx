import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cloud, CloudDownload, CloudUpload, ExternalLink, Github, LogIn, LogOut,
  RefreshCw, Shield, ShieldCheck, Sparkles, User, X,
} from "lucide-react";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";
import { Button } from "../ui/Button";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUpdateChecker } from "../../hooks/useUpdateChecker";
import { applyAppConfig } from "../../hooks/useAppBootstrap";
import { cloud, config, SyncAction, SyncResult, AuthStatus } from "../../lib/ipc";

type SyncView = "idle" | "syncing" | "conflict";

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncView, setSyncView] = useState<SyncView>("idle");
  const [error, setError] = useState<string | null>(null);
  const hasCheckedAuth = useRef(false);

  const cloudApiBaseUrl = useSettingsStore((s) => s.cloudApiBaseUrl);
  const cloudAutoSync = useSettingsStore((s) => s.cloudAutoSync);
  const updatesEnabled = useSettingsStore((s) => s.updatesEnabled);
  const updatesIntervalHours = useSettingsStore((s) => s.updatesIntervalHours);
  const updateState = useUpdateChecker(updatesEnabled, updatesIntervalHours);

  useEffect(() => {
    if (hasCheckedAuth.current) return;
    hasCheckedAuth.current = true;
    cloud.authStatus().then(setAuth).catch(() => {});
  }, []);

  // Automatic first sync when enabled and signed in.
  useEffect(() => {
    if (!cloudAutoSync || !auth?.signed_in || !open) return;
    void doSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudAutoSync, auth?.signed_in, open]);

  const doSync = useCallback(async () => {
    if (syncView === "syncing") return;
    setSyncView("syncing");
    setError(null);
    try {
      const cfg = await config.get();
      const result = await cloud.syncNow(cfg);
      setSyncResult(result);
      if (result.status === "pulled") {
        const merged = await config.get();
        applyAppConfig(merged);
      }
      setSyncView(result.status === "conflict" ? "conflict" : "idle");
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setSyncView("idle");
    }
  }, [syncView]);

  const resolve = async (action: SyncAction, remoteVersion: string) => {
    setBusy(true);
    setError(null);
    try {
      const cfg = await config.get();
      const result = await cloud.resolveConflict(action, cfg, remoteVersion);
      setSyncResult(result);
      setSyncView("idle");
      if (result.status === "pulled" || action === "merge") {
        const merged = await config.get();
        applyAppConfig(merged);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const signInOAuth = async (provider: "github" | "google") => {
    setBusy(true);
    setError(null);
    try {
      const status = await cloud.signInOAuth(provider);
      setAuth(status);
      setOpen(true);
      void doSync();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const signInPassword = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const status = await cloud.signInPassword(email.trim(), password);
      setAuth(status);
      setPassword("");
      setShowPasswordForm(false);
      void doSync();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await cloud.signOut();
      setAuth({ signed_in: false, email: null });
      setSyncResult(null);
      setSyncView("idle");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const cloudConfigured = !!cloudApiBaseUrl;
  const signedIn = !!auth?.signed_in;

  const statusLabel = syncResult
    ? syncResult.status === "synced" ? "In sync"
    : syncResult.status === "pushed" ? "Pushed changes"
    : syncResult.status === "pulled" ? "Pulled from cloud"
    : syncResult.status === "conflict" ? "Conflict detected"
    : syncResult.status === "signed_out" ? "Signed out"
    : "Disabled"
    : null;

  return (
    <div className="relative" data-tauri-no-drag>
      <button
        className="p-0.5 rounded-full transition-all cursor-pointer mr-1 ml-0.5 relative"
        style={{ outline: signedIn ? "1px solid rgba(90,200,150,0.35)" : "1px solid rgba(154,124,255,0.2)" }}
        onMouseEnter={(e) => (e.currentTarget.style.outline = "2px solid rgba(154,124,255,0.35)")}
        onMouseLeave={(e) => (e.currentTarget.style.outline = signedIn ? "1px solid rgba(90,200,150,0.35)" : "1px solid rgba(154,124,255,0.2)")}
        onClick={() => setOpen((v) => !v)}
        title="Account & Sync"
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: signedIn ? "rgba(90,200,150,0.14)" : "rgba(154,124,255,0.12)", color: signedIn ? "#5AC896" : "#9A7CFF" }}
        >
          <User size={13} />
        </div>
        {updateState.info?.available && !updateState.info.dismissed && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: "#FF6B6B", border: "2px solid #0A0D14" }} />
        )}
      </button>

      <MenuView
        variant="primary"
        open={open}
        onClose={() => setOpen(false)}
        className="absolute right-0 mt-1.5 w-72 z-[99999]"
        style={{ pointerEvents: "auto" }}
      >
        {/* ── Account / Auth ── */}
        <div className="px-3 pt-2 pb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: signedIn ? "rgba(90,200,150,0.14)" : "rgba(154,124,255,0.12)", color: signedIn ? "#5AC896" : "#9A7CFF" }}>
              <User size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate" style={{ color: "#E8EAF0" }}>
                {signedIn ? auth?.email ?? "Signed in" : "Cloud Sync"}
              </div>
              <div className="text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>
                {signedIn ? "Syncing aurora.json" : cloudConfigured ? "Sign in to sync settings" : "Set API base URL in Settings"}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-2 my-1 px-2.5 py-1.5 text-[11px] rounded-md" style={{ color: "#FF6B6B", background: "rgba(255,107,107,0.08)" }}>
            {error}
          </div>
        )}

        {!signedIn && cloudConfigured && (
          <>
            <MenuViewSeparator />
            <div className="px-2 py-1 space-y-1">
              <Button variant="secondary" size="md" className="w-full" disabled={busy} onClick={() => signInOAuth("github")}>
                <Github size={13} /> Continue with GitHub
              </Button>
              <Button variant="secondary" size="md" className="w-full" disabled={busy} onClick={() => signInOAuth("google")}>
                <Sparkles size={13} /> Continue with Google
              </Button>
              <button
                className="w-full text-center text-[11px] pt-1 transition-colors cursor-pointer"
                style={{ color: "rgba(79,140,255,0.8)" }}
                onClick={() => setShowPasswordForm((v) => !v)}
              >
                {showPasswordForm ? "Hide email sign-in" : "Sign in with email"}
              </button>
              {showPasswordForm && (
                <div className="space-y-1.5 pt-1">
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-[12px] rounded-md outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#E8EAF0" }}
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") signInPassword(); }}
                    className="w-full px-2.5 py-1.5 text-[12px] rounded-md outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#E8EAF0" }}
                  />
                  <Button variant="primary" size="sm" className="w-full" disabled={busy || !email.trim() || !password} onClick={signInPassword}>
                    <LogIn size={12} /> Sign in
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Sync ── */}
        <MenuViewSeparator />
        <div className="px-2 py-1 space-y-1">
          <div className="flex items-center justify-between px-1.5 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "rgba(232,234,240,0.35)" }}>
              <Cloud size={11} /> Settings Sync
            </span>
            {statusLabel && (
              <span className="text-[11px] flex items-center gap-1" style={{ color: syncView === "conflict" ? "#FFB86B" : "rgba(90,200,150,0.8)" }}>
                <ShieldCheck size={11} /> {statusLabel}
              </span>
            )}
          </div>

          {syncView === "conflict" && syncResult?.remote_version ? (
            <div className="space-y-1">
              <div className="px-1.5 text-[11px]" style={{ color: "rgba(232,234,240,0.45)" }}>
                Your settings changed on another device. Choose what to keep.
              </div>
              <div className="flex gap-1.5">
                <Button variant="secondary" size="sm" className="flex-1" disabled={busy} onClick={() => resolve("keep_local", syncResult.remote_version!)}>
                  <CloudUpload size={12} /> Keep local
                </Button>
                <Button variant="secondary" size="sm" className="flex-1" disabled={busy} onClick={() => resolve("keep_cloud", syncResult.remote_version!)}>
                  <CloudDownload size={12} /> Keep cloud
                </Button>
                <Button variant="primary" size="sm" className="flex-1" disabled={busy} onClick={() => resolve("merge", syncResult.remote_version!)}>
                  <RefreshCw size={12} /> Merge
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" size="md" className="w-full" disabled={busy || !signedIn || !cloudConfigured || syncView === "syncing"} onClick={doSync}>
              {syncView === "syncing" ? (
                <><RefreshCw size={13} className="animate-spin" /> Syncing…</>
              ) : (
                <><RefreshCw size={13} /> Sync now</>
              )}
            </Button>
          )}
        </div>

        {/* ── Updates ── */}
        {updatesEnabled && (
          <>
            <MenuViewSeparator />
            <div className="px-2 py-1">
              <div className="flex items-center justify-between px-1.5 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "rgba(232,234,240,0.35)" }}>
                  <Shield size={11} /> Updates
                </span>
                {updateState.checking && <RefreshCw size={11} className="animate-spin" style={{ color: "rgba(232,234,240,0.3)" }} />}
              </div>
              {updateState.info?.available && !updateState.info.dismissed ? (
                <div className="space-y-1">
                  <div className="px-1.5 text-[11px] flex items-center gap-1.5" style={{ color: "rgba(232,234,240,0.6)" }}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#FF6B6B" }} />
                    Aurora {updateState.info.latest_version} is available
                    <span className="ml-auto text-[10px]" style={{ color: "rgba(232,234,240,0.3)" }}>v{updateState.info.current_version}</span>
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
                <Button variant="ghost" size="sm" className="w-full" onClick={updateState.refresh}>
                  <RefreshCw size={12} /> Check for updates
                </Button>
              )}
            </div>
          </>
        )}

        {signedIn && (
          <>
            <MenuViewSeparator />
            <MenuViewItem icon={<LogOut size={13} />} onClick={signOut} danger>
              Sign out
            </MenuViewItem>
          </>
        )}
      </MenuView>
    </div>
  );
}
