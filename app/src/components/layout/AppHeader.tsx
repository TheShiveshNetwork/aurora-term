import { useCallback, useEffect, useRef, useState } from "react";
import { Command, ExternalLink, FileText, FolderOpen, History, Menu, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, PanelBottom, PanelBottomClose, PinIcon, PinOff, Plus, Search, Settings, SplitSquareHorizontal, SquareTerminal, Terminal, User, ChevronRight, GitBranch } from "lucide-react";
import { WindowControls } from "../ui/WindowControls";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";
import auroraIcon from "/static/aurora-icon.svg";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

interface AppHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  agentOverlayOpen: boolean;
  onToggleAgentOverlay: () => void;
  chatInputOpen: boolean;
  onToggleChatInput: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onOpenRecentFile: (path: string) => void;
  onNewWindow: () => void;
  onNewTab: () => void;
  onCloseSession: () => void;
  onCloseTab: () => void;
  onCloseOtherTabs: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onToggleTabBar: () => void;
  onShowTerminalView: () => void;
  onShowFileView: () => void;
  onShowAgentView: () => void;
  onExit: () => void;
  theme: "dark" | "light";
  tabBarVisible: boolean;
  viewMode: "terminal" | "file";
  projectName: string;
}

export function AppHeader({
  sidebarCollapsed,
  onToggleSidebar,
  agentOverlayOpen,
  onToggleAgentOverlay,
  chatInputOpen,
  onToggleChatInput,
  menuOpen,
  onToggleMenu,
  onOpenFolder,
  onOpenFile,
  onOpenRecentFile,
  onNewWindow,
  onNewTab,
  onCloseSession,
  onCloseTab,
  onCloseOtherTabs,
  onOpenSettings,
  onToggleTheme,
  onToggleTabBar,
  onShowTerminalView,
  onShowFileView,
  onShowAgentView,
  onExit,
  theme,
  tabBarVisible,
  viewMode,
  projectName,
}: AppHeaderProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [searchCollapsed, setSearchCollapsed] = useState(false);

  const measureSearchSpace = useCallback(() => {
    const header = headerRef.current;
    if (!header) return;
    const left = header.querySelector<HTMLElement>("#header-left");
    const right = header.querySelector<HTMLElement>("#header-right");
    if (!left || !right) return;
    const available = header.offsetWidth - left.offsetWidth - right.offsetWidth - 32;
    setSearchCollapsed(available < 180);
  }, []);

  useEffect(() => {
    measureSearchSpace();
    const ro = new ResizeObserver(measureSearchSpace);
    const header = headerRef.current;
    if (header) ro.observe(header);
    return () => ro.disconnect();
  }, [measureSearchSpace]);

  useEffect(() => {
    try {
      getCurrentWindow().setMinSize(new LogicalSize(660, 400));
    } catch {
      // not running in Tauri
    }
  }, []);

  return (
    <header
      id="aurora-tab-bar"
      ref={headerRef}
      data-tauri-drag-region
      className="flex items-center w-full px-3 h-toolbar-height z-50 select-none gap-3"
      style={{
        background: "#0A0D14",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* ── Left: branding pill + view mode ── */}
      <div id="header-left" data-tauri-no-drag className="flex items-center gap-1.5 shrink-0">
        <img src={auroraIcon} alt="" className="w-8 h-8 rounded-[6px] shrink-0 object-cover" />
        <div className="relative">
          <button
            data-tauri-no-drag
            onClick={(event) => { event.stopPropagation(); onToggleMenu(); }}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-[10px] cursor-pointer select-none transition-colors"
            style={{
              background: menuOpen ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
              border: menuOpen ? "1px solid rgba(79,140,255,0.20)" : "1px solid rgba(255,255,255,0.07)",
            }}
            onMouseEnter={(e) => { if (!menuOpen) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
            onMouseLeave={(e) => { if (!menuOpen) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            title="Aurora Menu"
          >
            <span className="text-[13px] font-semibold" style={{ color: "rgba(232,234,240,0.85)" }}>{projectName}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: "rgba(232,234,240,0.35)" }}>
              <path d="M2.5 3.5L5 6.5L7.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <MenuView
            variant="primary"
            open={menuOpen}
            onClose={() => onToggleMenu()}
            className="absolute left-0 mt-1.5 w-60 z-[999]"
            style={{ pointerEvents: "auto" }}
          >
            <MenuViewItem icon={<FolderOpen size={13} />} onClick={onOpenFolder} shortcut="Ctrl+O">Open Folder</MenuViewItem>
            <MenuViewItem icon={<FileText size={13} />} onClick={onOpenFile} shortcut="Ctrl+P">Open File</MenuViewItem>
            <MenuViewItem icon={<History size={13} />} disabled>Open Recent…</MenuViewItem>
            <MenuViewSeparator />
            <MenuViewItem icon={<Plus size={13} />} onClick={onNewWindow} shortcut="Ctrl+Shift+N">New Window</MenuViewItem>
            <MenuViewItem icon={<SquareTerminal size={13} />} onClick={onNewTab} shortcut="Ctrl+T">New Tab</MenuViewItem>
            <MenuViewSeparator />
            <MenuViewItem icon={<Terminal size={13} />} onClick={onCloseSession}>Close Session</MenuViewItem>
            <MenuViewItem icon={<SplitSquareHorizontal size={13} />} onClick={onCloseTab}>Close Tab</MenuViewItem>
            <MenuViewItem icon={<SplitSquareHorizontal size={13} />} onClick={onCloseOtherTabs}>Close Other Tabs</MenuViewItem>
            <MenuViewSeparator />
            <MenuViewItem icon={<Command size={13} />} onClick={onOpenSettings} shortcut="Ctrl+Shift+P">Command Palette</MenuViewItem>
            <MenuViewItem icon={<Settings size={13} />} onClick={onToggleTheme}>Switch Mode ({theme})</MenuViewItem>
            <MenuViewSeparator />
            <MenuViewItem icon={<ExternalLink size={13} />} onClick={onExit} danger>Exit</MenuViewItem>
          </MenuView>
        </div>

        {/* View mode toggle */}
        <div
          className="flex items-center gap-0.5 ml-1 p-0.5 rounded-[12px]"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <ViewButton active={viewMode === "terminal"} onClick={onShowTerminalView} title="Terminal View">
            <SquareTerminal size={13} />
          </ViewButton>
          <ViewButton active={viewMode === "file"} onClick={onShowFileView} title="Workspace View">
            <FolderOpen size={13} />
          </ViewButton>
          <ViewButton active={false} onClick={onShowAgentView} title="Agent View">
            <Command size={13} />
          </ViewButton>
        </div>

        <IconBtn onClick={() => {/* implement a in-build git commands control view ui */ }} title={"Open Git View"}>
          <GitBranch size={14} />
        </IconBtn>
      </div>

      {/* ── Center: search bar ── */}
      <SearchBar collapsed={searchCollapsed} />

      {/* ── Right: panel toggles + pin + settings + avatar + window controls ── */}
      <div id="header-right" data-tauri-no-drag className="flex items-center gap-0.5 shrink-0">
        <IconBtn onClick={onToggleSidebar} title={sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}>
          {sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
        </IconBtn>

        <IconBtn onClick={onToggleAgentOverlay} title={agentOverlayOpen ? "Hide Agent Panel" : "Show Agent Panel"}>
          {agentOverlayOpen ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
        </IconBtn>

        <IconBtn onClick={onToggleChatInput} title={chatInputOpen ? "Hide Chat Input" : "Show Chat Input"}>
          {chatInputOpen ? <PanelBottomClose size={14} /> : <PanelBottom size={14} />}
        </IconBtn>

        <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.06)" }} />

        <IconBtn
          onClick={onToggleTabBar}
          title={tabBarVisible ? "Hide Tab Bar" : "Show Tab Bar"}
          active={!tabBarVisible}
        >
          {tabBarVisible ? <PinIcon size={13} /> : <PinOff size={13} />}
        </IconBtn>

        <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.06)" }} />

        <IconBtn onClick={onOpenSettings} title="Settings">
          <Settings size={14} />
        </IconBtn>

        <button
          data-tauri-no-drag
          className="p-0.5 rounded-full transition-all cursor-pointer mr-1 ml-0.5"
          style={{ outline: "1px solid rgba(154,124,255,0.2)" }}
          onMouseEnter={(e) => (e.currentTarget.style.outline = "2px solid rgba(154,124,255,0.35)")}
          onMouseLeave={(e) => (e.currentTarget.style.outline = "1px solid rgba(154,124,255,0.2)")}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: "rgba(154,124,255,0.12)", color: "#9A7CFF" }}
          >
            <User size={13} />
          </div>
        </button>

        <WindowControls />
      </div>
    </header>
  );
}

function ViewButton({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      data-tauri-no-drag
      onClick={onClick}
      title={title}
      className="p-2 rounded-[9px] transition-all cursor-pointer"
      style={{
        background: active ? "rgba(79,140,255,0.12)" : "transparent",
        color: active ? "#4F8CFF" : "rgba(232,234,240,0.4)",
        border: active ? "1px solid rgba(79,140,255,0.20)" : "1px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          e.currentTarget.style.color = "rgba(232,234,240,0.7)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "rgba(232,234,240,0.4)";
        }
      }}
    >
      {children}
    </button>
  );
}

function SearchBar({ collapsed }: { collapsed?: boolean }) {
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = focused || value.length > 0;

  useEffect(() => {
    if (!collapsed) setIconOpen(false);
  }, [collapsed]);

  if (collapsed && !iconOpen) {
    return (
      <div className="flex-1 flex justify-center">
        <button
          onClick={() => setIconOpen(true)}
          className="p-2 rounded-[10px] transition-colors cursor-pointer"
          style={{ color: "rgba(232,234,240,0.45)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#E8EAF0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,234,240,0.45)"; }}
          title="Search"
        >
          <Search size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex justify-center" data-tauri-drag-region>
      <div
        className="relative flex items-center h-9 py-1 px-2 gap-3 transition-all duration-200 warp-input-glow rounded-md w-full"
        style={{
          maxWidth: collapsed ? "220px" : "400px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <Search size={14} className="shrink-0" style={{ color: "rgba(232,234,240,0.3)" }} />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search…"
          className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/25 min-w-0"
          style={{ color: "#E8EAF0" }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={collapsed && iconOpen}
        />
        {!expanded && !collapsed && (
          <kbd
            className="shrink-0 text-sm flex items-center gap-1 font-mono px-1.5 py-0.5 rounded-[6px] select-none"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(232,234,240,0.35)",
            }}
          >
            {"CTRL"} {"P"}
          </kbd>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      data-tauri-no-drag
      onClick={onClick}
      title={title}
      className="p-2 rounded-[10px] transition-colors cursor-pointer"
      style={{
        background: active ? "rgba(79,140,255,0.10)" : "transparent",
        color: active ? "#4F8CFF" : "rgba(232,234,240,0.45)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          e.currentTarget.style.color = "#E8EAF0";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "rgba(232,234,240,0.45)";
        }
      }}
    >
      {children}
    </button>
  );
}