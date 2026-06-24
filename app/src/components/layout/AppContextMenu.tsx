import { Clipboard, Copy, Trash2 } from "lucide-react";

import { AppContextMenu as AppContextMenuState } from "../../stores/useAppShellStore";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";

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
    <MenuView variant="rightclick" open anchorX={contextMenu.x} anchorY={contextMenu.y} onClose={() => {}}>
      <MenuViewItem variant="rightclick" icon={<Copy size={14} />} onClick={onCopySelection}>
        Copy
      </MenuViewItem>
      <MenuViewItem variant="rightclick" icon={<Clipboard size={14} />} onClick={onPaste}>
        Paste
      </MenuViewItem>

      {contextMenu.source === "terminal" && (
        <>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" danger icon={<Trash2 size={14} />} onClick={onClearTerminal}>
            Clear Terminal
          </MenuViewItem>
        </>
      )}

      {contextMenu.source === "file" && (
        <>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" icon={<Copy size={14} />} onClick={onSelectAll}>
            Select All
          </MenuViewItem>
        </>
      )}
    </MenuView>
  );
}