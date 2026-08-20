import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SignIn from "./pages/SignIn";
import AuthCallback from "./pages/AuthCallback";
import "./styles/globals.css";

function AuthErrorScreen() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  const description = params.get("error_description");
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <img src="/aurora-icon.png" alt="Aurora" className="mx-auto mb-5 h-10 w-10 rounded-lg" />
        <p className="text-[14px] text-on-surface-variant">Sign-in failed.</p>
        <p className="mt-2 text-[12px] text-on-surface-variant/70">
          {description ? description.replace(/\+/g, " ") : (error ?? "Unknown error")}
        </p>
        <a
          href="/signin"
          className="mt-5 inline-block rounded-full border border-outline bg-surface px-5 py-2.5 text-[13px] font-medium transition-colors hover:border-primary/50"
        >
          Back to sign in
        </a>
      </div>
    </div>
  );
}

function route() {
  const params = new URLSearchParams(location.search);
  // Supabase (or the provider) may redirect OAuth errors to the Site URL with
  // ?error=… — show a clear screen regardless of which route that lands on.
  if (params.get("error")) return <AuthErrorScreen />;
  const path = location.pathname;
  if (path.startsWith("/signin")) return <SignIn />;
  if (path.startsWith("/auth/callback")) return <AuthCallback />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{route()}</React.StrictMode>,
);
