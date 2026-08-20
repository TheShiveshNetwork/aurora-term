import { Loader2 } from "lucide-react";
import { useState } from "react";
import { startOAuth } from "../../lib/aurora";
import { Button, Container, GithubIcon, GoogleIcon } from "../../components/ui";

export default function SignInPage() {
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
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <Container className="max-w-sm">
        <div className="w-full rounded-3xl border border-outline bg-surface/70 p-8 glow">
          <div className="mb-6 flex items-center gap-2.5">
            <img src="/aurora-icon.png" alt="Aurora" className="h-7 w-7 rounded-md object-contain" />
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
      </Container>
    </div>
  );
}
