import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppShellView from "./views/AppShellView";
import SettingsPage from "./components/settings/SettingsPage";

export default function App() {
  const isSettings = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).has("settings");

  useEffect(() => {
    if (!isSettings) {
      getCurrentWindow().show();
    }
  }, [isSettings]);

  if (isSettings) {
    return <SettingsPage />;
  }

  return <AppShellView />;
}

