import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { RootLayout } from "./components/layout/RootLayout";
import LandingPage from "./pages/Landing/LandingPage";
import SignInPage from "./pages/SignIn/SignInPage";
import AuthCallbackPage from "./pages/AuthCallback/AuthCallbackPage";
import DownloadPage from "./pages/Download/DownloadPage";
import "./styles/globals.css";

function AuthErrorScreen() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  const description = params.get("error_description");
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <img src="/aurora-icon.png" alt="Aurora" className="mx-auto mb-5 h-10 w-10 rounded-lg object-contain" />
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

// Intercept same-origin internal link clicks so navigation happens client-side
// (pushState) instead of a full reload. External links, new-tab targets, and
// in-page hash anchors fall through to the browser's default behavior.
function useClientRouter() {
  const [pathname, setPathname] = useState(() => location.pathname);

  useEffect(() => {
    const onPop = () => setPathname(location.pathname);
    window.addEventListener("popstate", onPop);

    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as HTMLElement)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      const target = anchor.getAttribute("target");
      if (!href || target || href.startsWith("http") || href.startsWith("//") || href.startsWith("#")) {
        return;
      }
      e.preventDefault();
      if (href !== location.pathname) {
        history.pushState({}, "", href);
        setPathname(href);
      }
    };

    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return pathname;
}

function App() {
  const pathname = useClientRouter();

  // Scroll to top whenever the route changes.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  function resolve() {
    const params = new URLSearchParams(location.search);
    if (params.get("error")) return <AuthErrorScreen />;
    if (pathname.startsWith("/signin")) return <SignInPage />;
    if (pathname.startsWith("/auth/callback")) return <AuthCallbackPage />;
    if (pathname.startsWith("/download")) return <DownloadPage />;
    return <LandingPage />;
  }

  return <RootLayout>{resolve()}</RootLayout>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
