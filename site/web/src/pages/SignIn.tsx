import { Loader2 } from "lucide-react";
import { useState } from "react";
import { startOAuth } from "../lib/aurora";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#FF3D00"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#4CAF50"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"
      />
      <path
        fill="#1976D2"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function SignIn() {
  const [busy, setBusy] = useState<null | "google" | "github">(null);
  const [error, setError] = useState<string | null>(null);

  async function go(provider: "google" | "github") {
    setBusy(provider);
    setError(null);
    try {
      const url = await startOAuth(provider);
      location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-3xl border border-outline bg-surface/70 p-8 glow">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/aurora-icon.png" alt="Aurora" className="h-7 w-7 rounded-md" />
          <span className="text-[15px] font-semibold tracking-tight">Aurora</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in to sync</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-on-surface-variant">
          Connect your account to sync your Aurora settings across machines. You'll be sent
          back to the app when you're done.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => go("google")}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2.5 rounded-full border border-outline bg-surface px-5 py-3 text-[14px] font-medium transition-colors hover:border-primary/50 disabled:opacity-60"
          >
            {busy === "google" ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </button>
          <button
            onClick={() => go("github")}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2.5 rounded-full border border-outline bg-surface px-5 py-3 text-[14px] font-medium transition-colors hover:border-primary/50 disabled:opacity-60"
          >
            {busy === "github" ? <Loader2 size={16} className="animate-spin" /> : <GithubIcon />}
            Continue with GitHub
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
            {error}
          </p>
        )}

        <a
          href="/"
          className="mt-6 block text-center text-[12px] text-on-surface-variant transition-colors hover:text-on-background"
        >
          Back to home
        </a>
      </div>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.74.5 12.02c0 5.1 3.29 9.41 7.86 10.94.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.28 5.69.42.36.79 1.08.79 2.18v3.23c0 .31.21.67.8.56A11.53 11.53 0 0 0 23.5 12C23.5 5.74 18.27.5 12 .5Z" />
    </svg>
  );
}
