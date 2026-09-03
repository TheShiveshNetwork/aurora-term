import { getAllWebviewWindows, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

export interface SettingsTarget {
  section: string;
  sub: string;
  element?: string;
}

export async function openSettingsWindow(target?: SettingsTarget) {
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
    const dpr = window.devicePixelRatio || 1;
    const logX = Math.round(mainPos.x / dpr + (mainSize.width / dpr - 720) / 2);
    const logY = Math.round(mainPos.y / dpr + (mainSize.height / dpr - 520) / 2);

    const win = new WebviewWindow("settings", {
      title: "Settings - Aurora",
      url,
      width: 720,
      height: 520,
      minWidth: 670,
      minHeight: 400,
      resizable: true,
      decorations: false,
      x: logX,
      y: logY,
      visible: false,
    });

    win.once('tauri://created', async () => {
      try {
        await win.setPosition(new PhysicalPosition(Math.round(logX * dpr), Math.round(logY * dpr)));
        await win.show();
        await win.setFocus();
      } catch {}
    });
  }
}