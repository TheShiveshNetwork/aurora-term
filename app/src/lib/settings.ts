export interface SettingsTarget {
  section: string;
  sub: string;
  element?: string;
}

export async function openSettingsWindow(target?: SettingsTarget) {
  const { getAllWebviewWindows, WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const all = await getAllWebviewWindows();
  const existing = all.find((w) => w.label === "settings");

  if (existing) {
    if (target) {
      await (existing as any).eval(`window.__settingsNavigate(${JSON.stringify(target)})`);
    }
    await existing.show();
    await existing.setFocus();
  } else {
    const url = target
      ? `/?settings=true&settingsTarget=${encodeURIComponent(JSON.stringify(target))}`
      : "/?settings=true";
    new WebviewWindow("settings", {
      title: "Settings - Aurora",
      url,
      width: 720,
      height: 520,
      resizable: true,
      center: true,
    });
  }
}