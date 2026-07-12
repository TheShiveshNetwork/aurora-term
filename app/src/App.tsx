import AppShellView from "./views/AppShellView";
import SettingsPage from "./components/settings/SettingsPage";
import GitViewPage from "./views/GitViewPage";

export default function App() {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );

  if (params.has("settings")) {
    return <SettingsPage />;
  }

  if (params.has("gitview")) {
    return <GitViewPage />;
  }

  return <AppShellView />;
}

