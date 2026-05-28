import { Command, ExternalLink, FileText, FolderOpen, History, Menu, PanelLeft, PanelLeftClose, PinIcon, PinOff, Plus, Search, Settings, SplitSquareHorizontal, SquareTerminal, Terminal, User, ChevronRight } from "lucide-react";

import { WindowControls } from "../ui/WindowControls";

interface AppHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
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
}

export function AppHeader({
  sidebarCollapsed,
  onToggleSidebar,
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
}: AppHeaderProps) {
  return (
    <header
      id="aurora-tab-bar"
      data-tauri-drag-region
      className="flex justify-between items-center w-full px-4 h-toolbar-height bg-surface-container-lowest border-b border-outline-variant/5 z-50 shadow-sm select-none"
    >
      <div data-tauri-no-drag className="flex items-center gap-2 h-full">
        <div className="flex items-center gap-1">
          <button
            data-tauri-no-drag
            onClick={onToggleSidebar}
            className="p-2 hover:bg-surface rounded-lg transition-colors text-on-surface-variant cursor-pointer"
            title="Toggle Sidebar"
          >
            {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="relative">
            <button
              data-tauri-no-drag
              onClick={(event) => {
                event.stopPropagation();
                onToggleMenu();
              }}
              className={`p-2 hover:bg-surface rounded-lg transition-colors text-on-surface-variant cursor-pointer ${menuOpen ? "bg-surface text-primary" : ""}`}
              title="Toggle Menu"
            >
              <Menu size={14} />
            </button>
            {menuOpen && (
              <div
                className="absolute left-0 mt-1.5 w-60 bg-surface-container-lowest border border-outline-variant/20 rounded-md shadow-2xl py-1 z-[999] text-on-surface font-body-base animate-in fade-in slide-in-from-top-1 duration-150"
                onClick={(event) => event.stopPropagation()}
              >
                <button onClick={onOpenFolder} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <FolderOpen size={13} className="text-outline/65" />
                  <span className="flex-1">Open Folder</span>
                  <span className="text-[10px] text-outline/40">Ctrl+O</span>
                </button>
                <button onClick={onOpenFile} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <FileText size={13} className="text-outline/65" />
                  <span className="flex-1">Open File</span>
                  <span className="text-[10px] text-outline/40">Ctrl+P</span>
                </button>
                <div className="relative group/recent">
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                    <History size={13} className="text-outline/65" />
                    <span className="flex-1">Open Recent...</span>
                    <ChevronRight size={10} className="text-outline/40" />
                  </button>
                  <div className="absolute left-full top-0 ml-0.5 w-48 bg-surface-container-lowest border border-outline-variant/20 rounded-md shadow-2xl py-1 hidden group-hover/recent:block">
                    <button onClick={() => onOpenRecentFile("package.json")} className="w-full px-3 py-1.5 text-[11px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left truncate cursor-pointer">package.json</button>
                    <button onClick={() => onOpenRecentFile("src/App.tsx")} className="w-full px-3 py-1.5 text-[11px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left truncate cursor-pointer">src/App.tsx</button>
                    <button onClick={() => onOpenRecentFile("src/styles/globals.css")} className="w-full px-3 py-1.5 text-[11px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left truncate cursor-pointer">globals.css</button>
                  </div>
                </div>
                <div className="h-px bg-outline-variant/20 my-1 mx-2" />
                <button onClick={onNewWindow} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <Plus size={13} className="text-outline/65" />
                  <span className="flex-1">New Window</span>
                  <span className="text-[10px] text-outline/40">Ctrl+Shift+N</span>
                </button>
                <button onClick={onNewTab} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <SquareTerminal size={13} className="text-outline/65" />
                  <span className="flex-1">New Tab</span>
                  <span className="text-[10px] text-outline/40">Ctrl+T</span>
                </button>
                <div className="h-px bg-outline-variant/20 my-1 mx-2" />
                <button onClick={onCloseSession} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <Terminal size={13} className="text-outline/65" />
                  <span className="flex-1">Close Session</span>
                </button>
                <button onClick={onCloseTab} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <SplitSquareHorizontal size={13} className="text-outline/65" />
                  <span className="flex-1">Close Tab</span>
                  <span className="text-[10px] text-outline/40">Ctrl+W</span>
                </button>
                <button onClick={onCloseOtherTabs} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <SplitSquareHorizontal size={13} className="text-outline/65" />
                  <span className="flex-1">Close Other Tabs</span>
                </button>
                <div className="h-px bg-outline-variant/20 my-1 mx-2" />
                <button onClick={onOpenSettings} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <Command size={13} className="text-outline/65" />
                  <span className="flex-1">Command Palette</span>
                  <span className="text-[10px] text-outline/40">Ctrl+Shift+P</span>
                </button>
                <button onClick={onToggleTheme} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-variant/30 hover:text-primary transition-colors text-left cursor-pointer">
                  <Settings size={13} className="text-outline/65" />
                  <span className="flex-1">Switch Mode ({theme})</span>
                </button>
                <button onClick={onExit} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-red-500/10 hover:text-red-400 transition-colors text-left cursor-pointer">
                  <ExternalLink size={13} className="text-red-400/70" />
                  <span className="flex-1 font-semibold">Exit</span>
                </button>
              </div>
            )}
            <button
              onClick={onToggleTabBar}
              className={`p-2 hover:bg-surface rounded-lg transition-colors text-on-surface-variant cursor-pointer ${!tabBarVisible ? "bg-surface text-primary" : ""}`}
              title={tabBarVisible ? "Hide Tab Bar" : "Show Tab Bar"}
            >
              {tabBarVisible ? <PinIcon size={14} /> : <PinOff size={14} />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 ml-1">
          <button data-tauri-no-drag onClick={onShowTerminalView} className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === "terminal" ? "bg-primary/10 text-primary" : "bg-surface hover:bg-surface-bright/60 text-on-surface-variant/70 hover:text-on-surface-variant"}`} title="Terminal View">
            <SquareTerminal size={14} />
          </button>
          <button data-tauri-no-drag onClick={onShowFileView} className={`p-2 rounded-md transition-colors cursor-pointer ${viewMode === "file" ? "bg-primary/10 text-primary" : "bg-surface hover:bg-surface-bright/60 text-on-surface-variant/70 hover:text-on-surface-variant"}`} title="Workspace View">
            <FolderOpen size={14} />
          </button>
          <button data-tauri-no-drag onClick={onShowAgentView} className="p-2 hover:text-on-surface-variant bg-surface hover:bg-surface-bright/60 rounded-md transition-colors text-on-surface-variant/70 cursor-pointer" title="Agent View">
            <Command size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 max-w-xl mx-8" data-tauri-drag-region>
        <div className="relative group">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-outline/50 group-focus-within:text-primary transition-colors font-bold select-none">
            <Search size={16} />
          </span>
          <input
            type="text"
            placeholder="Search sessions, chats, agents, files..."
            className="w-full bg-surface-container-high/40 border border-outline-variant/10 rounded-xl h-8 pl-9 pr-4 text-sm placeholder:text-outline/40 outline-none focus:border-primary/20 transition-all shadow-inner"
          />
        </div>
      </div>

      <div data-tauri-no-drag className="flex items-center gap-2 h-full">
        <button data-tauri-no-drag onClick={onOpenSettings} className="p-2 hover:bg-surface-variant/30 rounded-lg transition-colors text-on-surface-variant cursor-pointer" title="Settings">
          <Settings size={14} />
        </button>
        <button data-tauri-no-drag className="p-1 hover:ring-2 ring-primary/20 rounded-full transition-all cursor-pointer mr-2">
          <div className="w-7 h-7 rounded-full bg-secondary-container/30 flex items-center justify-center text-secondary border border-secondary/20">
            <User size={14} />
          </div>
        </button>
        <WindowControls />
      </div>
    </header>
  );
}