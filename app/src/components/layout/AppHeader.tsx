import { Command, ExternalLink, FileText, FolderOpen, History, Menu, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, PanelBottom, PanelBottomClose, PinIcon, PinOff, Plus, Search, Settings, SplitSquareHorizontal, SquareTerminal, Terminal, User, ChevronRight, GitBranch } from "lucide-react";

import { WindowControls } from "../ui/WindowControls";
import auroraIcon from "/static/aurora-icon.png";

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
  return (
    <header
      id="aurora-tab-bar"
      data-tauri-drag-region
      className="flex justify-between items-center w-full px-3 h-toolbar-height z-50 select-none"
      style={{
        background: "#0A0D14",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* ── Left: branding pill + view mode ── */}
      <div data-tauri-no-drag className="flex items-center gap-1.5 h-full">
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
            {/* TODO: current open project setup — use proper workspace/project resolver */}
            <span className="text-[13px] font-semibold" style={{ color: "rgba(232,234,240,0.85)" }}>{projectName}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: "rgba(232,234,240,0.35)" }}>
              <path d="M2.5 3.5L5 6.5L7.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {menuOpen && (
            <div
              className="absolute left-0 mt-1.5 w-60 py-1 z-[999] animate-in fade-in slide-in-from-top-1 duration-150"
              style={{
                background: "#0F131A",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "14px",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 16px 40px rgba(0,0,0,0.5)",
              }}
              onClick={(event) => event.stopPropagation()}
            >

              <MenuButton icon={<FolderOpen size={13} />} onClick={onOpenFolder} shortcut="Ctrl+O">Open Folder</MenuButton>
              <MenuButton icon={<FileText size={13} />} onClick={onOpenFile} shortcut="Ctrl+P">Open File</MenuButton>
              <div className="relative group/recent">
                <button className="w-full flex items-center gap-3 px-3 py-2 text-[12px] text-on-surface-variant/80 transition-colors text-left cursor-pointer rounded-[8px] mx-1" style={{ width: "calc(100% - 8px)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <History size={13} className="text-on-surface-variant/60 shrink-0" />
                  <span className="flex-1">Open Recent…</span>
                  <ChevronRight size={14} className="text-on-surface-variant/60" />
                </button>
                <div className="absolute left-full top-0 ml-1 w-48 py-1 hidden group-hover/recent:block z-[1000]"
                  style={{
                    background: "#0F131A",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "14px",
                    boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
                  }}>
                  <SubMenuButton onClick={() => onOpenRecentFile("package.json")}>package.json</SubMenuButton>
                  <SubMenuButton onClick={() => onOpenRecentFile("src/App.tsx")}>src/App.tsx</SubMenuButton>
                  <SubMenuButton onClick={() => onOpenRecentFile("src/styles/globals.css")}>globals.css</SubMenuButton>
                </div>
              </div>

              <MenuDivider />
              <MenuButton icon={<Plus size={13} />} onClick={onNewWindow} shortcut="Ctrl+Shift+N">New Window</MenuButton>
              <MenuButton icon={<SquareTerminal size={13} />} onClick={onNewTab} shortcut="Ctrl+T">New Tab</MenuButton>
              <MenuDivider />
              <MenuButton icon={<Terminal size={13} />} onClick={onCloseSession}>Close Session</MenuButton>
              <MenuButton icon={<SplitSquareHorizontal size={13} />} onClick={onCloseTab} shortcut="Ctrl+W">Close Tab</MenuButton>
              <MenuButton icon={<SplitSquareHorizontal size={13} />} onClick={onCloseOtherTabs}>Close Other Tabs</MenuButton>
              <MenuDivider />
              <MenuButton icon={<Command size={13} />} onClick={onOpenSettings} shortcut="Ctrl+Shift+P">Command Palette</MenuButton>
              <MenuButton icon={<Settings size={13} />} onClick={onToggleTheme}>Switch Mode ({theme})</MenuButton>
              <div className="h-px mx-2 my-1" style={{ background: "rgba(255,255,255,0.05)" }} />
              <button
                onClick={onExit}
                className="w-full flex items-center gap-3 px-3 py-2 text-[12px] cursor-pointer text-left rounded-[8px]"
                style={{ color: "#FF6B6B", width: "calc(100% - 8px)", marginLeft: "4px" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,107,107,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <ExternalLink size={13} className="text-[#FF6B6B]/70 shrink-0" />
                <span className="flex-1 font-semibold">Exit</span>
              </button>
            </div>
          )}
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
      <div className="flex-1 max-w-lg mx-6 my-2" data-tauri-drag-region>
        <div
          className="relative flex items-center h-full py-1 px-2 gap-3 transition-all duration-200 warp-input-glow rounded-md"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <Search size={14} className="shrink-0" style={{ color: "rgba(232,234,240,0.3)" }} />
          <input
            type="text"
            placeholder="Search sessions, chats, agents, files…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/25"
            style={{ color: "#E8EAF0" }}
          />
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
        </div>
      </div>

      {/* ── Right: panel toggles + pin + settings + avatar + window controls ── */}
      <div data-tauri-no-drag className="flex items-center gap-0.5 h-full">
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

/* ── Internal helper components ─────────────────────────────────────── */
function MenuButton({
  children,
  icon,
  onClick,
  shortcut,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  shortcut?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-[7px] text-[12px] cursor-pointer text-left transition-colors"
      style={{ color: "rgba(232,234,240,0.75)", borderRadius: "8px", width: "calc(100% - 8px)", marginLeft: "4px" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        e.currentTarget.style.color = "#E8EAF0";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(232,234,240,0.75)";
      }}
    >
      {icon && <span style={{ color: "rgba(232,234,240,0.35)" }}>{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-[10px]" style={{ color: "rgba(232,234,240,0.25)" }}>{shortcut}</span>}
    </button>
  );
}

function SubMenuButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-[6px] text-[11px] cursor-pointer text-left truncate"
      style={{ color: "rgba(232,234,240,0.65)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        e.currentTarget.style.color = "#E8EAF0";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(232,234,240,0.65)";
      }}
    >
      {children}
    </button>
  );
}

function MenuDivider() {
  return <div className="h-px mx-2 my-1" style={{ background: "rgba(255,255,255,0.05)" }} />;
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