import { getAllWebviewWindows, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

export async function openGitViewWindow(projectDir: string) {
  const all = await getAllWebviewWindows();
  const existing = all.find((w) => w.label === "gitview");

  if (existing) {
    await existing.show();
    await existing.setFocus();
  } else {
    const projectName = projectDir.split(/[/\\]/).filter(Boolean).pop() || projectDir;
    const url = `/?gitview=true&projectDir=${encodeURIComponent(projectDir)}`;
    const windowTitle = `Aurora - ${projectName} git`;

    const mainPos = await getCurrentWindow().outerPosition();
    const mainSize = await getCurrentWindow().outerSize();
    const dpr = window.devicePixelRatio || 1;
    const logX = Math.round(mainPos.x / dpr + (mainSize.width / dpr - 720) / 2);
    const logY = Math.round(mainPos.y / dpr + (mainSize.height / dpr - 520) / 2);

    const win = new WebviewWindow("gitview", {
      title: windowTitle,
      url,
      width: 720,
      height: 520,
      minWidth: 500,
      minHeight: 400,
      resizable: true,
      decorations: false,
      x: logX,
      y: logY,
      visible: false,
    });

    win.once("tauri://created", async () => {
      try {
        await win.setPosition(new PhysicalPosition(Math.round(logX * dpr), Math.round(logY * dpr)));
        await win.show();
        await win.setFocus();
      } catch {}
    });
  }
}
