import { useCallback, useEffect, useRef, useState } from "react";
import {
  CloudUpload, Github, LogOut, RefreshCw, User,
} from "lucide-react";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";
import { Button } from "../ui/Button";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUpdateChecker } from "../../hooks/useUpdateChecker";
import { applyAppConfig } from "../../hooks/useAppBootstrap";
import { config, AuthStatus } from "../../lib/ipc";
import { cloud } from "../../lib/cloud";

// Safe display string: never exceed 24 chars; append "..." when truncated.
function truncateName(name: string | null | undefined): string {
  const safe = name ?? "";
  if (safe.length > 24) return safe.slice(0, 24) + "...";
  return safe;
}

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasCheckedAuth = useRef(false);

  const cloudSynced = useSettingsStore((s) => s.cloudSynced);
  const setCloudSynced = useSettingsStore((s) => s.setCloudSynced);
  const updatesEnabled = useSettingsStore((s) => s.updatesEnabled);
  const updateState = useUpdateChecker(updatesEnabled);

  const refreshAuth = useCallback(() => {
    cloud.authStatus().then(setAuth).catch(() => {});
  }, []);

  useEffect(() => {
    if (hasCheckedAuth.current) return;
    hasCheckedAuth.current = true;
    refreshAuth();
  }, [refreshAuth]);

  // Re-check auth whenever the deep-link handoff (or sign-out) fires.
  useEffect(() => cloud.onAuthChange(refreshAuth), [refreshAuth]);

  // Single sync action: reconcile to the cloud's canonical config. If nothing
  // is saved in the cloud yet, upload the current device's settings as the
  // seed; otherwise pull (download + apply) the cloud config. The local
  // `synced` flag is updated directly — no backend round-trip to compute state.
  const doSync = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const cfg = await config.get();
      const remote = await cloud.downloadSettings();
      if (!remote) {
        await cloud.uploadSettings(cfg);
      } else if (remote.payload) {
        await config.saveGlobal(remote.payload as any);
        applyAppConfig(remote.payload as any);
      }
      const saved = await config.get();
      await config.saveGlobal({ ...saved, cloud: { ...(saved.cloud ?? { auto_sync: false }), synced: true } });
      setCloudSynced(true);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, []);

  const signInOAuth = async (provider: "github" | "google") => {
    setBusy(true);
    setError(null);
    try {
      const status = await cloud.signInOAuth(provider);
      setAuth(status);
      setOpen(true);
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
      setAuth({ signed_in: false, email: null, username: null });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = !!auth?.signed_in;

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
                {signedIn ? truncateName(auth?.username ?? auth?.email) : "Authenticate"}
              </div>
              {!signedIn && 
              <div className="text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>
                Sign in to sync settings
              </div>
              }
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-2 my-1 px-2.5 py-1.5 text-[11px] rounded-md" style={{ color: "#FF6B6B", background: "rgba(255,107,107,0.08)" }}>
            {error}
          </div>
        )}

        {!signedIn && (
          <>
            <MenuViewSeparator />
            <div className="px-2 py-1 space-y-1">
              <Button variant="secondary" size="md" className="w-full" disabled={busy} onClick={() => signInOAuth("github")}>
                <Github size={13} /> Continue with GitHub
              </Button>
            </div>
          </>
        )}

        {/* ── Sync (only when signed in) ── */}
        {signedIn && (
          <>
            <MenuViewSeparator />
            <div className="px-2 py-1 space-y-1">
              <div className="flex items-center justify-between px-1.5 pb-1">
                <span className="text-[11px] font-semibold tracking-wider flex items-center gap-1.5" style={{ color: "rgba(232,234,240,0.35)" }}>
                  Settings Sync
                </span>
              </div>
              <Button variant="secondary" size="md" className="w-full" disabled={busy || cloudSynced} onClick={doSync}>
                <CloudUpload size={13} /> Sync settings
              </Button>
            </div>
          </>
        )}

      </MenuView>
    </div>
  );
}
