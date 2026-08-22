import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { NotificationView } from "./lib/notify";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { initCloud } from "./lib/cloud";
import "./styles/globals.css";
import "@xterm/xterm/css/xterm.css";

import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "./stores/useAgentStore";
import { useAppShellStore } from "./stores/useAppShellStore";
import { useSessionStore } from "./stores/useSessionStore";
import { useBlockStore } from "./stores/useBlockStore";

// Listen for the `aurora://auth/callback` deep link the web companion uses to
// hand off a Supabase session after GitHub sign-in.
initCloud();

(window as any).invoke = invoke;
(window as any).useAgentStore = useAgentStore;
(window as any).useAppShellStore = useAppShellStore;
(window as any).useSessionStore = useSessionStore;
(window as any).useBlockStore = useBlockStore;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <NotificationView />
  </React.StrictMode>,
);

