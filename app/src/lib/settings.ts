export async function openSettingsWindow() {
  const { getAllWebviewWindows, WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const all = await getAllWebviewWindows();
  const existing = all.find((w) => w.label === "settings");
  if (existing) {
    await existing.show();
    await existing.setFocus();
  } else {
    new WebviewWindow("settings", {
      title: "Settings - Aurora",
      url: "/?settings=true",
      width: 720,
      height: 520,
      resizable: true,
      center: true,
    });
  }
}