import { useEffect, useRef } from "react";
import { getCurrentWindow, availableMonitors, LogicalPosition } from "@tauri-apps/api/window";

const TITLE_BAR_VISIBLE = 30;

export function useWindowClamp() {
  const clamping = useRef(false);

  useEffect(() => {
    const win = getCurrentWindow();

    const clamp = async () => {
      if (clamping.current) return;
      clamping.current = true;
      try {
        const pos = await win.outerPosition();
        const monitors = await availableMonitors();
        if (monitors.length === 0) return;

        let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const m of monitors) {
          minX = Math.min(minX, m.position.x);
          maxX = Math.max(maxX, m.position.x + m.size.width);
          maxY = Math.max(maxY, m.position.y + m.size.height);
        }

        let newX = pos.x;
        let newY = pos.y;

        if (pos.y < -TITLE_BAR_VISIBLE + 10) newY = -TITLE_BAR_VISIBLE + 10;
        if (pos.y > maxY - 100) newY = maxY - 100;
        if (pos.x + 100 > maxX) newX = maxX - 100;
        if (pos.x + 100 < minX) newX = minX;

        if (newX !== pos.x || newY !== pos.y) {
          await win.setPosition(new LogicalPosition(newX, newY));
        }
      } catch {
        // not running in Tauri or missing permission
      } finally {
        clamping.current = false;
      }
    };

    clamp();

    let unlisten: (() => void) | null = null;
    const setup = async () => {
      try {
        unlisten = await win.onMoved(clamp);
      } catch {
        // not running in Tauri
      }
    };
    setup();
    return () => { unlisten?.(); };
  }, []);
}