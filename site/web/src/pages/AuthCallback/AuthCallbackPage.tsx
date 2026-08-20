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
  const [handoffFailed, setHandoffFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: number | undefined;
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
        handoffToApp(session);
        fallbackTimer = window.setTimeout(() => {
          if (!cancelled) {
            setHandoffFailed(true);
            setStatus("Couldn't open Aurora automatically.");
          }
        }, 1500);
      } catch (e) {
        setStatus(`Sign-in failed: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
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
            {handoffFailed && (
              <p className="mt-1 text-[12px] text-on-surface-variant/60">
                Make sure the Aurora desktop app is running — start it with{" "}
                <code className="rounded bg-surface px-1">pnpm tauri dev</code> — then click
                below.
              </p>
            )}
            <button
              onClick={async () => {
                const { data } = await supabase.auth.getSession();
                if (data.session) handoffToApp(data.session);
              }}
              className="mt-5 rounded-full border border-outline bg-surface px-5 py-2.5 text-[13px] font-medium transition-colors hover:border-primary/50"
            >
              Open Aurora app
            </button>
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
