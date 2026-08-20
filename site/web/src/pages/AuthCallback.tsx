import { useEffect, useState } from "react";
import { exchangeOAuth, handoffToApp } from "../lib/aurora";

export default function AuthCallback() {
  const [status, setStatus] = useState("Completing sign in…");

  useEffect(() => {
    (async () => {
      const code = new URLSearchParams(location.search).get("code");
      if (!code) {
        setStatus("Sign-in failed: missing authorization code.");
        return;
      }
      try {
        const token = await exchangeOAuth(code);
        handoffToApp(token);
      } catch (e) {
        setStatus(`Sign-in failed: ${(e as Error).message}`);
      }
    })();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <img
          src="/aurora-icon.png"
          alt="Aurora"
          className="mx-auto mb-5 h-10 w-10 rounded-lg"
        />
        <p className="text-[14px] text-on-surface-variant">{status}</p>
        <p className="mt-2 text-[12px] text-on-surface-variant/70">
          Returning you to the Aurora app…
        </p>
      </div>
    </div>
  );
}
