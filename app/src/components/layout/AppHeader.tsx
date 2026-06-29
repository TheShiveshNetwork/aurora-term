import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Command, ExternalLink, FileText, FolderOpen, History, Menu, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, PanelBottom, PanelBottomClose, PinIcon, PinOff, Plus, Search, Settings, SplitSquareHorizontal, SquareTerminal, Terminal, User, GitBranch, File, Sliders } from "lucide-react";
import type { AppViewMode } from "../../stores/useAppShellStore";
import { WindowControls } from "../ui/WindowControls";
import { MenuView, MenuViewItem, MenuViewSeparator } from "../ui/MenuView";

import auroraIcon from "/static/aurora-icon.svg";
import { SETTINGS_MANIFEST, categoryFor } from "../settings/settingsManifest";
import { system } from "../../lib/ipc";

interface AppHeaderProps {
  isStandalone?: boolean;
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
  onOpenGitView: () => void;
  gitViewActive: boolean;
  onExit: () => void;
  theme: "dark" | "light";
  tabBarVisible: boolean;
  viewMode: AppViewMode;
  projectName: string;
  cwdAbsolute: string;
  onOpenFileAtPath: (path: string) => void;
  noFolder?: boolean;
}

export function AppHeader({
  isStandalone,
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
  onOpenGitView,
  gitViewActive,
  onExit,
  theme,
  tabBarVisible,
  viewMode,
  projectName,
  cwdAbsolute,
  onOpenFileAtPath,
  noFolder,
}: AppHeaderProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [searchCollapsed, setSearchCollapsed] = useState(false);

  const measureSearchSpace = useCallback(() => {
    const header = headerRef.current;
    if (!header) return;
    const searchBar = header.querySelector<HTMLElement>('[data-search-bar]');
    if (searchBar) {
      setSearchCollapsed(searchBar.offsetWidth < 140);
    }
  }, []);

  useEffect(() => {
    measureSearchSpace();
    const ro = new ResizeObserver(measureSearchSpace);
    const header = headerRef.current;
    if (header) ro.observe(header);
    return () => ro.disconnect();
  }, [measureSearchSpace]);

  return (
    <header
      id="aurora-tab-bar"
      ref={headerRef}
      data-tauri-drag-region
      className="grid grid-cols-[1fr_minmax(0,400px)_1fr] items-center w-full pl-3 py-0 h-auto z-50 select-none gap-3 shrink-0"
      style={{
        background: "#0A0D14",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* ── Left: branding pill + view mode ── */}
      <div id="header-left" data-tauri-drag-region className="flex items-center gap-1.5 py-1 shrink-0">
        {noFolder ? (
          <div className="relative">
            <button
              data-tauri-no-drag
              onClick={(event) => { event.stopPropagation(); onToggleMenu(); }}
              className="flex items-center justify-center w-8 h-8 rounded-[10px] cursor-pointer select-none transition-colors my-1"
              style={{
                background: menuOpen ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
                border: menuOpen ? "1px solid rgba(79,140,255,0.20)" : "1px solid rgba(255,255,255,0.07)",
              }}
              onMouseEnter={(e) => { if (!menuOpen) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
              onMouseLeave={(e) => { if (!menuOpen) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              title="Aurora Menu"
            >
              <Menu size={16} style={{ color: "rgba(232,234,240,0.6)" }} />
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
        ) : (
          <>
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
          </>
        )}

        {!noFolder && (
          <>
            {/* View mode toggle */}
            <div
              data-tauri-no-drag
              className="flex items-center gap-0.5 ml-1 p-0.5 rounded-[12px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
            >
              <ViewButton active={viewMode === "terminal"} onClick={onShowTerminalView} title="Terminal View">
                <SquareTerminal size={13} />
              </ViewButton>
              <ViewButton active={viewMode === "file"} onClick={onShowFileView} title="Workspace View">
                <FolderOpen size={13} />
              </ViewButton>
              <ViewButton active={viewMode === "agent"} onClick={onShowAgentView} title="Agent View">
                <Command size={13} />
              </ViewButton>
            </div>

            <IconBtn onClick={onOpenGitView} title={"Open Git View"} active={gitViewActive}>
              <GitBranch size={14} />
            </IconBtn>
          </>
        )}
      </div>

      {/* ── Center: search bar ── */}
      <div data-tauri-drag-region className="flex justify-center min-w-0">
        <SearchBar collapsed={searchCollapsed} cwdAbsolute={cwdAbsolute} onOpenFileAtPath={onOpenFileAtPath} />
      </div>

      {/* ── Right: panel toggles + pin + settings + avatar + window controls ── */}
      <div data-tauri-drag-region className="flex items-center justify-end gap-0.5 shrink-0">
        <div id="header-right" data-tauri-drag-region className="flex items-center gap-0.5 py-1">
          {!noFolder && !isStandalone && (
            <>
              <IconBtn onClick={onToggleSidebar} title={sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}>
                {sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
              </IconBtn>

              <IconBtn onClick={onToggleAgentOverlay} title={agentOverlayOpen ? "Hide Agent Panel" : "Show Agent Panel"}>
                {agentOverlayOpen ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
              </IconBtn>

              {viewMode !== "agent" && (
                <IconBtn onClick={onToggleChatInput} title={chatInputOpen ? "Hide Chat Input" : "Show Chat Input"}>
                  {chatInputOpen ? <PanelBottomClose size={14} /> : <PanelBottom size={14} />}
                </IconBtn>
              )}
            </>
          )}

          {!noFolder && viewMode !== "agent" && <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.06)" }} />}

          {!noFolder && viewMode !== "agent" && !isStandalone && (
            <IconBtn
              onClick={onToggleTabBar}
              title={tabBarVisible ? "Hide Tab Bar" : "Show Tab Bar"}
              active={!tabBarVisible}
            >
              {tabBarVisible ? <PinIcon size={13} /> : <PinOff size={13} />}
            </IconBtn>
          )}

          {!noFolder && !isStandalone && (
            <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.06)" }} />
          )}

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
        </div>
        <div id="window-controls" data-tauri-no-drag className="flex h-full items-center shrink-0">
          <WindowControls />
        </div>
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

function SearchBar({ collapsed, cwdAbsolute, onOpenFileAtPath }: { collapsed?: boolean; cwdAbsolute: string; onOpenFileAtPath: (path: string) => void }) {
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [searchResults, setSearchResults] = useState<{ name: string; path: string; is_dir: boolean }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const expanded = focused || value.length > 0;

  useEffect(() => {
    if (!collapsed) setIconOpen(false);
  }, [collapsed]);

  useEffect(() => {
    const handler = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("focus-search-bar", handler);
    return () => window.removeEventListener("focus-search-bar", handler);
  }, []);

  useEffect(() => {
    if (!focused) {
      setValue("");
      setSearchResults([]);
    }
  }, [focused]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = value.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    if (!cwdAbsolute) return;
    setSearchLoading(true);
    searchTimer.current = setTimeout(() => {
      const seq = ++searchSeq.current;
      system.searchFiles(cwdAbsolute, trimmed)
        .then(nodes => {
          if (seq !== searchSeq.current) return;
          setSearchResults(nodes.map(n => ({ name: n.name, path: n.path, is_dir: n.is_dir })));
          setSearchLoading(false);
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setSearchLoading(false);
        });
    }, 200);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [value, cwdAbsolute]);

  const query = value.toLowerCase().trim();

  const matchedDirs = useMemo(() => {
    if (!query || !searchResults.length) return [];
    const seen = new Set<string>();
    return searchResults
      .filter(f => f.is_dir && f.name.toLowerCase().includes(query) && !seen.has(f.name) && seen.add(f.name))
      .slice(0, 6);
  }, [query, searchResults]);

  const matchedRegularFiles = useMemo(() => {
    if (!query || !searchResults.length) return [];
    const seen = new Set<string>();
    return searchResults
      .filter(f => !f.is_dir && f.name.toLowerCase().includes(query) && !seen.has(f.name) && seen.add(f.name))
      .slice(0, 8);
  }, [query, searchResults]);

  const matchedSettings = useMemo(() => {
    if (!query) return [];
    return SETTINGS_MANIFEST.filter(s => {
      const cat = categoryFor(s.section, s.subPage);
      return s.label.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        cat.toLowerCase().includes(query);
    }).slice(0, 6);
  }, [query]);

  const dirCount = matchedDirs.length;
  const fileCount = matchedRegularFiles.length;
  const settingCount = matchedSettings.length;
  const totalItems = dirCount + fileCount + settingCount;
  const showDropdown = focused && query.length > 0 && totalItems > 0;

  useEffect(() => {
    setSelectedIndex(-1);
  }, [matchedDirs, matchedRegularFiles, matchedSettings]);

  useEffect(() => {
    if (selectedIndex >= 0) {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const executeSelected = () => {
    if (selectedIndex < 0 || selectedIndex >= totalItems) return;
    if (selectedIndex < dirCount) {
      const d = matchedDirs[selectedIndex];
      if (d) { setFocused(false); setValue(""); window.dispatchEvent(new CustomEvent("sidebar-open-in-new-tab", { detail: { path: d.path } })); }
    } else if (selectedIndex < dirCount + fileCount) {
      const f = matchedRegularFiles[selectedIndex - dirCount];
      if (f) { setFocused(false); setValue(""); onOpenFileAtPath(f.path); }
    } else {
      const s = matchedSettings[selectedIndex - dirCount - fileCount];
      if (s) {
        setFocused(false);
        setValue("");
        import("../../lib/settings").then(({ openSettingsWindow }) =>
          openSettingsWindow({ section: s.section, sub: s.subPage, element: s.elementId })
        );
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % totalItems);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(prev => (prev <= 0 ? totalItems - 1 : prev - 1));
        break;
      case "Enter":
        e.preventDefault();
        executeSelected();
        break;
      case "Escape":
        e.preventDefault();
        inputRef.current?.blur();
        setFocused(false);
        break;
    }
  };

  if (collapsed && !iconOpen) {
    return (
      <div data-search-bar data-tauri-no-drag className="flex-1 flex justify-center min-w-0">
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

  if (collapsed && iconOpen) {
    return (
      <>
        <div data-search-bar className="flex-1 min-w-0" />
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.3)" }}
          onClick={() => { setIconOpen(false); setFocused(false); }}
        >
          <div className="w-full max-w-md px-4" onClick={(e) => e.stopPropagation()}>
            <div
              className="flex items-center h-9 py-1 px-2 gap-3 rounded-md w-full"
              style={{
                background: "rgba(15,19,26,0.95)",
                border: focused ? "1px solid rgba(79,140,255,0.3)" : "1px solid rgba(255,255,255,0.07)",
                backdropFilter: "blur(12px)",
              }}
            >
              <Search size={14} className="shrink-0" style={{ color: focused ? "rgba(79,140,255,0.7)" : "rgba(232,234,240,0.3)" }} />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search files and settings…"
                className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/25 min-w-0"
                style={{ color: "#E8EAF0" }}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                  setTimeout(() => setFocused(false), 150);
                }}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              {searchLoading && value.trim() && (
                <svg className="animate-spin shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: "rgba(79,140,255,0.6)" }}>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
              )}
            </div>
            {showDropdown && (
              <div
                ref={dropdownRef}
                className="mt-1 rounded-lg overflow-hidden z-[9999] select-text"
                style={{
                  background: "#141822",
                  border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                  maxHeight: "320px",
                }}
              >
                {matchedDirs.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: "rgba(232,234,240,0.35)", background: "rgba(255,255,255,0.03)" }}>
                      <Terminal size={11} />
                      Open terminal in
                    </div>
                    {matchedDirs.map((d, di) => {
                      const idx = di;
                      const isSelected = idx === selectedIndex;
                      return (
                        <button
                          key={d.path}
                          ref={isSelected ? selectedRef : undefined}
                          onClick={() => { setIconOpen(false); setValue(""); window.dispatchEvent(new CustomEvent("sidebar-open-in-new-tab", { detail: { path: d.path } })); }}
                          className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-[12px] transition-colors cursor-pointer"
                          style={{
                            color: "#E8EAF0",
                            background: isSelected ? "rgba(79,140,255,0.15)" : "transparent",
                          }}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          <FolderOpen size={13} style={{ color: "rgba(79,140,255,0.6)" }} />
                          <span className="truncate">{d.name}/</span>
                          <span className="ml-auto text-[10px] shrink-0" style={{ color: "rgba(232,234,240,0.3)" }}>New Terminal</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {(matchedDirs.length > 0 && (matchedRegularFiles.length > 0 || matchedSettings.length > 0)) && (
                  <div className="h-px mx-3" style={{ background: "rgba(255,255,255,0.06)" }} />
                )}
                {matchedRegularFiles.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: "rgba(232,234,240,0.35)", background: "rgba(255,255,255,0.03)" }}>
                      <File size={11} />
                      Files
                    </div>
                    {matchedRegularFiles.map((f, fi) => {
                      const idx = dirCount + fi;
                      const isSelected = idx === selectedIndex;
                      return (
                        <button
                          key={f.path}
                          ref={isSelected ? selectedRef : undefined}
                          onClick={() => { setIconOpen(false); setValue(""); onOpenFileAtPath(f.path); }}
                          className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-[12px] transition-colors cursor-pointer"
                          style={{
                            color: "#E8EAF0",
                            background: isSelected ? "rgba(79,140,255,0.15)" : "transparent",
                          }}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          <FileText size={13} style={{ color: "rgba(232,234,240,0.4)" }} />
                          <span className="truncate">{f.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div data-search-bar data-tauri-no-drag className="flex-1 flex justify-center min-w-0">
      <div className="relative w-full" style={{ maxWidth: "400px" }}>
        <div
          className="flex items-center h-9 py-1 px-2 gap-3 transition-all duration-200 warp-input-glow rounded-md w-full"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: focused ? "1px solid rgba(79,140,255,0.3)" : "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <Search size={14} className="shrink-0" style={{ color: focused ? "rgba(79,140,255,0.7)" : "rgba(232,234,240,0.3)" }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search files and settings…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/25 min-w-0"
            style={{ color: "#E8EAF0" }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setTimeout(() => setFocused(false), 150);
            }}
            onKeyDown={handleKeyDown}
          />
          {searchLoading && value.trim() ? (
            <svg className="animate-spin shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: "rgba(79,140,255,0.6)" }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
            </svg>
          ) : !expanded ? (
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
          ) : null}
        </div>

        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-[999] select-text"
            style={{
              background: "#141822",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              maxHeight: "320px",
            }}
          >
            {matchedDirs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "rgba(232,234,240,0.35)", background: "rgba(255,255,255,0.03)" }}>
                  <Terminal size={11} />
                  Open terminal in
                </div>
                {matchedDirs.map((d, di) => {
                  const idx = di;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={d.path}
                      ref={isSelected ? selectedRef : undefined}
                      onClick={() => { setFocused(false); setValue(""); window.dispatchEvent(new CustomEvent("sidebar-open-in-new-tab", { detail: { path: d.path } })); }}
                      className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-[12px] transition-colors cursor-pointer"
                      style={{
                        color: "#E8EAF0",
                        background: isSelected ? "rgba(79,140,255,0.15)" : "transparent",
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <FolderOpen size={13} style={{ color: "rgba(79,140,255,0.6)" }} />
                      <span className="truncate">{d.name}/</span>
                      <span className="ml-auto text-[10px] shrink-0" style={{ color: "rgba(232,234,240,0.3)" }}>New Terminal</span>
                    </button>
                  );
                })}
              </div>
            )}
            {(matchedDirs.length > 0 && (matchedRegularFiles.length > 0 || matchedSettings.length > 0)) && (
              <div className="h-px mx-3" style={{ background: "rgba(255,255,255,0.06)" }} />
            )}
            {matchedRegularFiles.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "rgba(232,234,240,0.35)", background: "rgba(255,255,255,0.03)" }}>
                  <File size={11} />
                  Files
                </div>
                {matchedRegularFiles.map((f, fi) => {
                  const idx = dirCount + fi;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={f.path}
                      ref={isSelected ? selectedRef : undefined}
                      onClick={() => { setFocused(false); setValue(""); onOpenFileAtPath(f.path); }}
                      className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-[12px] transition-colors cursor-pointer"
                      style={{
                        color: "#E8EAF0",
                        background: isSelected ? "rgba(79,140,255,0.15)" : "transparent",
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <FileText size={13} style={{ color: "rgba(232,234,240,0.4)" }} />
                      <span className="truncate">{f.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {(matchedRegularFiles.length > 0 && matchedSettings.length > 0) && (
              <div className="h-px mx-3" style={{ background: "rgba(255,255,255,0.06)" }} />
            )}
            {matchedSettings.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "rgba(232,234,240,0.35)", background: "rgba(255,255,255,0.03)" }}>
                  <Sliders size={11} />
                  Settings
                </div>
                {matchedSettings.map((s, si) => {
                  const idx = dirCount + fileCount + si;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={s.id}
                      ref={isSelected ? selectedRef : undefined}
                      onClick={() => executeSelected()}
                      className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-[12px] transition-colors cursor-pointer"
                      style={{
                        color: "#E8EAF0",
                        background: isSelected ? "rgba(79,140,255,0.15)" : "transparent",
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <Settings size={13} style={{ color: "rgba(154,124,255,0.6)" }} />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{s.label}</span>
                        <span className="text-[11px] truncate" style={{ color: "rgba(232,234,240,0.35)" }}>{s.description}</span>
                      </div>
                      <span className="ml-auto text-[10px] shrink-0 px-1.5 py-0.5 rounded" style={{ color: "rgba(232,234,240,0.25)", background: "rgba(255,255,255,0.04)" }}>{categoryFor(s.section, s.subPage)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
      type="button"
      data-tauri-no-drag
      title={title}
      onClick={onClick}
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