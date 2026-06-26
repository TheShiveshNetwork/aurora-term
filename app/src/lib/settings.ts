export interface SettingsTarget {
  section: string;
  sub: string;
  element?: string;
}

export async function openSettingsWindow(target?: SettingsTarget) {
  const { getAllWebviewWindows, WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { getCurrentWindow, PhysicalPosition } = await import("@tauri-apps/api/window");
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

    const mainPos = await getCurrentWindow().outerPosition();
    const mainSize = await getCurrentWindow().outerSize();
    const x = Math.round(mainPos.x + (mainSize.width - 720) / 2);
    const y = Math.round(mainPos.y + (mainSize.height - 520) / 2);

    const win = new WebviewWindow("settings", {
      title: "Settings - Aurora",
      url,
      width: 720,
      height: 520,
      resizable: true,
      decorations: false,
      x,
      y,
      visible: false,
    });

    win.once('tauri://created', async () => {
      try {
        await win.setPosition(new PhysicalPosition(x, y));
        await win.show();
        await win.setFocus();
      } catch {}
    });
  }
}