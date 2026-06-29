import React, { useState, useRef, useEffect } from "react";
import WindowSettingsView from "./WindowSettingsView";
import EditorSettingsView from "./EditorSettingsView";
import WorkspaceSettingsView from "./WorkspaceSettingsView";
import AppearanceSettingsView from "./AppearanceSettingsView";
import AISettingsView from "./AISettingsView";
import KeybindingsSettingsView from "./KeybindingsSettingsView";
import AboutSettingsView from "./AboutSettingsView";
import { Breadcrumbs, SettingsContext, DraftSettings } from "./SettingsShared";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { useAIStore } from "../../stores/useAIStore";
import { config } from "../../lib/ipc";
import { WindowControls } from "../ui/WindowControls";
import { emit } from "@tauri-apps/api/event";
import { Button } from "../ui/Button";

interface SettingsTarget {
  section: string;
  sub: string;
  element?: string;
}

type SectionId = "general" | "agent" | "about";
type SubPageId = string;

interface SubPage {
  id: SubPageId;
  label: string;
  view: React.ReactNode;
}

interface Section {
  id: SectionId;
  label: string;
  items: SubPage[];
}

const SECTIONS: Section[] = [
  {
    id: "general",
    label: "General",
    items: [
      { id: "window", label: "Window Settings", view: <WindowSettingsView /> },
      { id: "editor", label: "Editor Settings", view: <EditorSettingsView /> },
      { id: "workspace", label: "Workspace", view: <WorkspaceSettingsView /> },
      { id: "appearance", label: "Appearance", view: <AppearanceSettingsView /> },
      { id: "keybindings", label: "Keybindings", view: <KeybindingsSettingsView /> },
    ],
  },
  {
    id: "agent",
    label: "Agent",
    items: [
      { id: "ai", label: "AI Providers", view: <AISettingsView /> },
    ],
  },
  {
    id: "about",
    label: "About",
    items: [
      { id: "about", label: "About", view: <AboutSettingsView /> },
    ],
  },
];

export default function SettingsPage() {
  const [nav, setNav] = useState<{ section: SectionId; sub: SubPageId }>({
    section: "general",
    sub: "window",
  });
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSettings | null>(null);
  const [initial, setInitial] = useState<DraftSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const bootstrapReady = useAppShellStore((s) => s.bootstrapReady);

  const { section, sub } = nav;
  const activeSection = SECTIONS.find((s) => s.id === section)!;
  const activePage = activeSection.items.find((p) => p.id === sub) ?? activeSection.items[0];
  const breadcrumbItems = ["Settings", activeSection.label, activePage.label];

  useEffect(() => {
    if (!bootstrapReady) return;

    const s = useSettingsStore.getState();
    const a = useAIStore.getState();
    const shell = useAppShellStore.getState();

    const buildProvider = (p: any) => ({
      enabled: p.enabled ?? true,
      fast_model: p.fastModel || "",
      balanced_model: p.balancedModel || "",
      powerful_model: p.powerfulModel || "",
      base_url: p.baseUrl ?? null,
    });

    const initialVal: DraftSettings = {
      config: {
        terminal: {
          shell: "",
          font_family: s.fontFamily,
          font_size: s.fontSize,
          scrollback: 10000,
          theme: s.theme === "light" ? "light" : "dark",
          cursor_style: s.cursorStyle,
          cursor_blink: s.cursorBlink,
          restore_tabs: s.restoreTabs,
        },
        ai: {
          active_provider: a.activeProvider,
          auto_explain: true,
          context_lines: 50,
          anthropic: buildProvider(a.providers.anthropic),
          openai: buildProvider(a.providers.openai),
          gemini: buildProvider(a.providers.gemini),
          nvidia: buildProvider(a.providers.nvidia),
          ollama: buildProvider(a.providers.ollama),
          groq: buildProvider(a.providers.groq),
        },
        keybindings: {
          mode: "vim",
          open_palette: s.keybindingOverrides["command-palette"] || "ctrl+p",
          open_ai_bar: s.keybindingOverrides["toggle-ai-bar"] || "ctrl+k",
          new_tab: s.keybindingOverrides["new-tab"] || "ctrl+t",
          close_tab: s.keybindingOverrides["close-tab"] || "ctrl+w",
          split_h: s.keybindingOverrides["split-horizontal"] || "ctrl+shift+d",
          split_v: s.keybindingOverrides["split-vertical"] || "ctrl+shift+e",
          overrides: { ...s.keybindingOverrides },
        },
        appearance: {
          compact_ui: s.compactUi,
          show_statusbar: s.showStatusbar,
          blur_sidebar: s.blurSidebar,
        },
        editor: {
          theme: s.editorTheme,
          show_minimap: s.showMinimap,
          git_gui_mode: s.gitGuiMode,
        },
      },
      sidebarCollapsed: shell.sidebarCollapsed,
      showAiBar: shell.showAiBar,
      chatInputOpen: shell.chatInputOpen,
      tabBarVisible: shell.tabBarVisible,
    };

    setDraft(JSON.parse(JSON.stringify(initialVal)));
    setInitial(initialVal);
  }, [bootstrapReady]);

  useEffect(() => {
    if (draft?.config.terminal.theme) {
      document.documentElement.setAttribute("data-theme", draft.config.terminal.theme);
    }
  }, [draft?.config.terminal.theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetRaw = params.get("settingsTarget");
    if (targetRaw) {
      try {
        const target: SettingsTarget = JSON.parse(decodeURIComponent(targetRaw));
        if (target.section && target.sub) {
          setNav({ section: target.section as SectionId, sub: target.sub });
          if (target.element) setScrollTarget(target.element);
        }
      } catch { /* ignore malformed */ }
    }
  }, []);

  useEffect(() => {
    (window as any).__settingsNavigate = (target: SettingsTarget) => {
      setNav({ section: target.section as SectionId, sub: target.sub });
      setScrollTarget(target.element || null);
    };
    return () => { delete (window as any).__settingsNavigate; };
  }, []);

  useEffect(() => {
    if (!scrollTarget || !contentRef.current) return;
    const el = contentRef.current.querySelector(`#${scrollTarget}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("setting-flash");
      const timer = setTimeout(() => el.classList.remove("setting-flash"), 1500);
      return () => clearTimeout(timer);
    }
    setScrollTarget(null);
  }, [scrollTarget, sub]);

  const updateDraft = (updater: (prev: DraftSettings) => void) => {
    setDraft((prev) => {
      if (!prev) return null;
      const next = JSON.parse(JSON.stringify(prev));
      updater(next);
      return next;
    });
  };

  const handleApply = async () => {
    if (!draft) return;
    setApplying(true);
    try {
      await config.saveGlobal(draft.config);
      await emit("ui_state_changed", {
        sidebarCollapsed: draft.sidebarCollapsed,
        showAiBar: draft.showAiBar,
        chatInputOpen: draft.chatInputOpen,
        tabBarVisible: draft.tabBarVisible,
      });
      setInitial(JSON.parse(JSON.stringify(draft)));
    } catch (e) {
      console.error("Apply failed", e);
    }
    setApplying(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await config.saveGlobal(draft.config);
      await emit("ui_state_changed", {
        sidebarCollapsed: draft.sidebarCollapsed,
        showAiBar: draft.showAiBar,
        chatInputOpen: draft.chatInputOpen,
        tabBarVisible: draft.tabBarVisible,
      });
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      await getCurrentWebviewWindow().close();
    } catch (e) {
      console.error("Save failed", e);
    }
    setSaving(false);
  };

  if (!draft || !initial) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "#0A0D14", color: "#E8EAF0" }}>
        <div className="text-xs opacity-50">Loading settings...</div>
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <SettingsContext.Provider value={{ draft, updateDraft }}>
      <div className="h-screen flex flex-col overflow-hidden select-none" style={{ background: "#0A0D14", color: "#E8EAF0" }}>
        <style>{`.setting-flash { outline: 2px solid rgba(79,140,255,0.4); outline-offset: -2px; border-radius: 8px; transition: outline-color 0.15s; }`}</style>
        <header
          data-tauri-drag-region
          className="flex items-center justify-between h-auto pl-3 shrink-0"
          style={{ background: "#0A0D14", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold tracking-wider uppercase select-none" style={{ color: "rgba(232,234,240,0.4)" }}>Settings</span>
          </div>
          <WindowControls />
        </header>
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div
            className="w-52 shrink-0 flex flex-col py-3 px-2 overflow-y-auto"
            style={{ borderRight: "1px solid rgba(255,255,255,0.06)", background: "rgba(15,19,26,0.6)" }}
          >
            {SECTIONS.map((sec) => (
              <div key={sec.id} className="mb-3">
                <div
                  className="w-full px-3 py-1.5 text-xs text-on-surface-variant/50 cursor-default"
                >
                  {sec.label}
                </div>
                <div className="mt-0.5 space-y-0.5">
                  {sec.items.map((p) => {
                    const selected = sub === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setNav({ section: sec.id, sub: p.id })}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-all cursor-pointer rounded-sm"
                        style={{
                          background: selected ? "rgba(255,255,255,0.04)" : "transparent",
                          border: selected ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
                        }}
                        onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                        onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-h-0">
            <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
              <Breadcrumbs items={breadcrumbItems} />
              {activePage.view}
            </div>

            {/* Footer Bar */}
            <div className="shrink-0 px-6 py-3 flex items-center justify-end gap-3 border-t"
              style={{ background: "#0A0D14", borderColor: "rgba(255,255,255,0.06)" }}>
              {dirty && (
                <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>
                  Unsaved changes
                </span>
              )}
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleApply}
                  disabled={saving || applying || !dirty}
                  variant="secondary"
                  size="md"
                >
                  {applying ? "Applying..." : "Apply"}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving || applying || !dirty}
                  variant="primary"
                  size="md"
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsContext.Provider>
  );
}
