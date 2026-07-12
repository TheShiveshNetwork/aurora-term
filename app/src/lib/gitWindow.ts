export async function openGitViewWindow(projectDir: string) {
  const { getAllWebviewWindows, WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { getCurrentWindow, PhysicalPosition } = await import("@tauri-apps/api/window");
  const all = await getAllWebviewWindows();
  const existing = all.find((w) => w.label === "gitview");

  if (existing) {
    await existing.show();
    await existing.setFocus();
  } else {
    const projectName = projectDir.split(/[/\\]/).filter(Boolean).pop() || projectDir;
    const url = `/?gitview=true&projectDir=${encodeURIComponent(projectDir)}`;
    const windowTitle = `Aurora - ${projectName} Git View`;

    const mainPos = await getCurrentWindow().outerPosition();
    const mainSize = await getCurrentWindow().outerSize();
    const x = Math.round(mainPos.x + (mainSize.width - 720) / 2);
    const y = Math.round(mainPos.y + (mainSize.height - 520) / 2);

    const win = new WebviewWindow("gitview", {
      title: windowTitle,
      url,
      width: 720,
      height: 520,
      minWidth: 500,
      minHeight: 400,
      resizable: true,
      decorations: false,
      x,
      y,
      visible: false,
    });

    win.once("tauri://created", async () => {
      try {
        await win.setPosition(new PhysicalPosition(x, y));
        await win.show();
        await win.setFocus();
      } catch {}
    });
  }
}
