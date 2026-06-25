import { Clipboard, Copy, Trash2 } from "lucide-react";

import { AppContextMenu as AppContextMenuState } from "../../stores/useAppShellStore";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";

interface AppContextMenuProps {
  contextMenu: AppContextMenuState;
  onPaste: () => void;
  onCopySelection: () => void;
  onClearTerminal: () => void;
  onSelectAll: () => void;
  onGoToDefinition: () => void;
  onPeekDefinition: () => void;
  onFindReferences: () => void;
  onRenameSymbol: () => void;
  onFormatDocument: () => void;
  onRunFile: () => void;
}

export function AppContextMenu({ contextMenu, onPaste, onCopySelection, onClearTerminal, onSelectAll, onGoToDefinition, onPeekDefinition, onFindReferences, onRenameSymbol, onFormatDocument, onRunFile }: AppContextMenuProps) {
  if (!contextMenu) return null;

  return (
    <MenuView variant="rightclick" open anchorX={contextMenu.x} anchorY={contextMenu.y} onClose={() => {}}>
      <MenuViewItem variant="rightclick" onClick={onCopySelection}>
        Copy
      </MenuViewItem>
      <MenuViewItem variant="rightclick" onClick={onPaste}>
        Paste
      </MenuViewItem>

      {contextMenu.source === "terminal" && (
        <>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" danger onClick={onClearTerminal}>
            Clear Terminal
          </MenuViewItem>
        </>
      )}

      {contextMenu.source === "file" && (
        <>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={onSelectAll}>
            Select All
          </MenuViewItem>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={onGoToDefinition}>
            Go to Definition
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={onPeekDefinition}>
            Peek Definition
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={onFindReferences}>
            Find All References
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={onRenameSymbol}>
            Rename Symbol
          </MenuViewItem>
          <MenuViewSeparator />
          <MenuViewItem variant="rightclick" onClick={onFormatDocument}>
            Format Document
          </MenuViewItem>
          <MenuViewItem variant="rightclick" onClick={onRunFile}>
            Run / Debug
          </MenuViewItem>
        </>
      )}
    </MenuView>
  );
}