import AppShellView from "./views/AppShellView";
import SettingsPage from "./components/settings/SettingsPage";

export default function App() {
  const isSettings = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).has("settings");

  if (isSettings) {
    return <SettingsPage />;
  }

  return <AppShellView />;
}

