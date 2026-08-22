import { useEffect, useState } from "react";
import { handleCallback, handoffToApp } from "../../lib/aurora";
import { supabase } from "../../lib/supabaseClient";

function readError(): string | null {
  const merged = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const error = merged.get("error") ?? hash.get("error");
  if (!error) return null;
  const desc =
    merged.get("error_description") ?? hash.get("error_description") ?? error;
  return desc;
}

export default function AuthCallbackPage() {
  const [status, setStatus] = useState("Completing sign in…");
  const [done, setDone] = useState(false);
  // After a moment, if the browser blocked the automatic (non-gesture) handoff,
  // gently surface the manual button instead of showing a scary failure.
  const [showManualHint, setShowManualHint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let hintTimer: number | undefined;
    (async () => {
      const error = readError();
      if (error) {
        setStatus(`Sign-in failed: ${error}`);
        return;
      }

      try {
        const session = await handleCallback();
        if (cancelled) return;
        if (!session) {
          setStatus("Sign-in failed: no session established.");
          return;
        }
        setStatus("Opening the Aurora app…");
        setDone(true);
        // Best-effort automatic handoff. Browsers block external-protocol
        // navigations that aren't triggered by a user gesture, so this may be
        // silently ignored — the button below covers that case.
        handoffToApp(session);
        hintTimer = window.setTimeout(() => {
          if (!cancelled) setShowManualHint(true);
        }, 1500);
      } catch (e) {
        setStatus(`Sign-in failed: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      if (hintTimer) window.clearTimeout(hintTimer);
    };
  }, []);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <img
          src="/aurora-icon.png"
          alt="Aurora"
          className="mx-auto mb-5 h-10 w-10 rounded-lg object-contain"
        />
        <p className="text-[14px] text-on-surface-variant">{status}</p>

        {done ? (
          <>
            <p className="mt-2 text-[13px] text-on-surface-variant/80">
              Returning you to the Aurora app…
            </p>
            <button
              onClick={async () => {
                const { data } = await supabase.auth.getSession();
                if (data.session) handoffToApp(data.session);
              }}
              className="mt-5 rounded-full border border-outline bg-surface px-5 py-2.5 text-[13px] font-medium transition-colors hover:border-primary/50"
            >
              Open Aurora app
            </button>
            {showManualHint && (
              <p className="mt-3 text-[12px] text-on-surface-variant/60">
                Aurora didn't open? Make sure the desktop app is installed and
                running, then click the button above.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-[12px] text-on-surface-variant/70">
            Returning you to the Aurora app…
          </p>
        )}
      </div>
    </div>
  );
}
