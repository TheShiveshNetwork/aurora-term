import { Clipboard, Copy, Trash2 } from "lucide-react";

import { AppContextMenu as AppContextMenuState } from "../../stores/useAppShellStore";
import { RightClickMenuItem, RightClickMenuPanel, RightClickMenuSeparator } from "../ui/RightClickMenu";

interface AppContextMenuProps {
  contextMenu: AppContextMenuState;
  onPaste: () => void;
  onCopySelection: () => void;
  onClearTerminal: () => void;
  onSelectAll: () => void;
}

export function AppContextMenu({ contextMenu, onPaste, onCopySelection, onClearTerminal, onSelectAll }: AppContextMenuProps) {
  if (!contextMenu) return null;

  return (
    <RightClickMenuPanel anchorX={contextMenu.x} anchorY={contextMenu.y} open={true}>
      <RightClickMenuItem icon={<Copy size={14} />} onClick={onCopySelection}>
        Copy
      </RightClickMenuItem>
      <RightClickMenuItem icon={<Clipboard size={14} />} onClick={onPaste}>
        Paste
      </RightClickMenuItem>

      {contextMenu.source === "terminal" && (
        <>
          <RightClickMenuSeparator />
          <RightClickMenuItem danger icon={<Trash2 size={14} />} onClick={onClearTerminal}>
            Clear Terminal
          </RightClickMenuItem>
        </>
      )}

      {contextMenu.source === "file" && (
        <>
          <RightClickMenuSeparator />
          <RightClickMenuItem icon={<Copy size={14} />} onClick={onSelectAll}>
            Select All
          </RightClickMenuItem>
        </>
      )}
    </RightClickMenuPanel>
  );
}