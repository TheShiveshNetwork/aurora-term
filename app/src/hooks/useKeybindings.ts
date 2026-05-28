import { useSettingsStore, EditorMode } from "../stores/useSettingsStore";
import { pty } from "../lib/ipc";

export function useKeybindings() {
  const { mode, setMode } = useSettingsStore();

  const handleKeyDown = (
    e: KeyboardEvent,
    term: any, // xterm Terminal instance
    sessionId: string,
    onExecuteCommand?: (cmd: string) => void
  ) => {
    // Global keys (independent of mode)
    if (e.ctrlKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      // Trigger command palette event
      window.dispatchEvent(new CustomEvent("toggle-command-palette"));
      return true;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      // Trigger AI bar event
      window.dispatchEvent(new CustomEvent("toggle-ai-bar"));
      return true;
    }

    switch (mode) {
      case "INSERT":
        if (e.key === "Escape") {
          e.preventDefault();
          setMode("NORMAL");
          // De-focus xterm cursor or switch style
          term.options.cursorStyle = "block";
          return true;
        }
        // Let xterm.js / PTY handle the keypress directly
        return false;

      case "NORMAL":
        e.preventDefault();
        
        if (e.key === "i" || e.key === "a" || e.key === "o") {
          setMode("INSERT");
          term.options.cursorStyle = "bar";
          return true;
        }
        if (e.key === ":") {
          setMode("COMMAND");
          window.dispatchEvent(new CustomEvent("focus-command-line"));
          return true;
        }
        if (e.key === "j") {
          // Scroll terminal down by 1 line
          term.scrollLines(1);
          return true;
        }
        if (e.key === "k") {
          // Scroll terminal up by 1 line
          term.scrollLines(-1);
          return true;
        }
        if (e.key === "G") {
          term.scrollToBottom();
          return true;
        }
        if (e.key === "g") {
          // Double g is standard
          term.scrollToTop();
          return true;
        }
        if (e.key === "y") {
          // Copy current selection
          const selection = term.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection);
          }
          return true;
        }
        if (e.key === "v") {
          setMode("VISUAL");
          return true;
        }
        return true;

      case "VISUAL":
        if (e.key === "Escape") {
          e.preventDefault();
          term.clearSelection();
          setMode("NORMAL");
          return true;
        }
        return false;

      case "COMMAND":
        if (e.key === "Escape") {
          e.preventDefault();
          setMode("NORMAL");
          return true;
        }
        return false;
    }
  };

  return {
    mode,
    setMode,
    handleKeyDown,
  };
}
