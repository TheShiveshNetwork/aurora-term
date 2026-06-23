import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "@xterm/xterm/css/xterm.css";

import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "./stores/useAgentStore";
import { useAppShellStore } from "./stores/useAppShellStore";
import { useSessionStore } from "./stores/useSessionStore";
import { useBlockStore } from "./stores/useBlockStore";

(window as any).invoke = invoke;
(window as any).useAgentStore = useAgentStore;
(window as any).useAppShellStore = useAppShellStore;
(window as any).useSessionStore = useSessionStore;
(window as any).useBlockStore = useBlockStore;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

