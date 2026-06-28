import React, { useState, useRef, useEffect } from "react";
import WindowSettingsView from "./WindowSettingsView";
import EditorSettingsView from "./EditorSettingsView";
import WorkspaceSettingsView from "./WorkspaceSettingsView";
import AppearanceSettingsView from "./AppearanceSettingsView";
import AISettingsView from "./AISettingsView";
import KeybindingsSettingsView from "./KeybindingsSettingsView";
import AboutSettingsView from "./AboutSettingsView";
import { Breadcrumbs } from "./SettingsShared";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppShellStore } from "../../stores/useAppShellStore";
import { useAIStore } from "../../stores/useAIStore";
import { config } from "../../lib/ipc";
import type { AppConfig } from "../../lib/ipc";
import { WindowControls } from "../ui/WindowControls";

interface SettingsTarget {
  section: string;
  sub: string;
  element?: string;
}

function buildAppConfig(): AppConfig {
  const s = useSettingsStore.getState();
  const a = useAIStore.getState();
  const shell = useAppShellStore.getState();
  return {
    terminal: {
      shell: "",
      font_family: s.fontFamily,
      font_size: s.fontSize,
      scrollback: 10000,
      theme: s.theme === "light" ? "light" : "dark",
      cursor_style: s.cursorStyle,
      cursor_blink: s.cursorBlink,
    },
    ai: {
      active_provider: a.activeProvider,
      auto_explain: true,
      context_lines: 50,
      anthropic: {
        fast_model: a.providers.anthropic.fastModel,
        balanced_model: a.providers.anthropic.balancedModel,
        powerful_model: a.providers.anthropic.powerfulModel,
        base_url: a.providers.anthropic.baseUrl ?? null,
      },
      openai: {
        fast_model: a.providers.openai.fastModel,
        balanced_model: a.providers.openai.balancedModel,
        powerful_model: a.providers.openai.powerfulModel,
        base_url: a.providers.openai.baseUrl ?? null,
      },
      gemini: {
        fast_model: a.providers.gemini.fastModel,
        balanced_model: a.providers.gemini.balancedModel,
        powerful_model: a.providers.gemini.powerfulModel,
        base_url: a.providers.gemini.baseUrl ?? null,
      },
      nvidia: {
        fast_model: a.providers.nvidia.fastModel,
        balanced_model: a.providers.nvidia.balancedModel,
        powerful_model: a.providers.nvidia.powerfulModel,
        base_url: a.providers.nvidia.baseUrl ?? null,
      },
      ollama: {
        fast_model: a.providers.ollama.fastModel,
        balanced_model: a.providers.ollama.balancedModel,
        powerful_model: a.providers.ollama.powerfulModel,
        base_url: a.providers.ollama.baseUrl ?? null,
      },
      groq: {
        fast_model: a.providers.groq.fastModel,
        balanced_model: a.providers.groq.balancedModel,
        powerful_model: a.providers.groq.powerfulModel,
        base_url: a.providers.groq.baseUrl ?? null,
      },
    },
    keybindings: {
      mode: "vim",
      open_palette: s.keybindingOverrides["command-palette"] || "ctrl+p",
      open_ai_bar: s.keybindingOverrides["toggle-ai-bar"] || "ctrl+k",
      new_tab: s.keybindingOverrides["new-tab"] || "ctrl+t",
      close_tab: s.keybindingOverrides["close-tab"] || "ctrl+w",
      split_h: s.keybindingOverrides["split-horizontal"] || "ctrl+shift+d",
      split_v: s.keybindingOverrides["split-vertical"] || "ctrl+shift+e",
    },
    appearance: {
      compact_ui: s.compactUi,
      show_statusbar: s.showStatusbar,
      blur_sidebar: s.blurSidebar,
    },
    ui: {
      sidebar_collapsed: shell.sidebarCollapsed,
      tab_bar_visible: shell.tabBarVisible,
      pinned_tabs: [],
    },
  };
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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  const { section, sub } = nav;
  const activeSection = SECTIONS.find((s) => s.id === section)!;
  const activePage = activeSection.items.find((p) => p.id === sub) ?? activeSection.items[0];
  const breadcrumbItems = ["Settings", activeSection.label, activePage.label];

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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

  useEffect(() => {
    const mark = () => { if (mountedRef.current) setDirty(true); };
    const unsub1 = useSettingsStore.subscribe(mark);
    const unsub2 = useAppShellStore.subscribe(mark);
    const unsub3 = useAIStore.subscribe(mark);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const handleApply = () => {
    // Changes already applied via Zustand stores — no persistence
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cfg = buildAppConfig();
      await config.set(cfg);
      setDirty(false);
    } catch { /* persist error - swallowed */ }
    setSaving(false);
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().close();
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none" style={{ background: "#0A0D14", color: "#E8EAF0" }}>
      <style>{`.setting-flash { outline: 2px solid rgba(79,140,255,0.4); outline-offset: -2px; border-radius: 8px; transition: outline-color 0.15s; }`}</style>
      <header
        data-tauri-drag-region
        className="flex items-center justify-between h-auto pl-3 shrink-0"
        style={{ background: "#0A0D14", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <span className="text-xs font-semibold tracking-wider uppercase select-none" style={{ color: "rgba(232,234,240,0.4)" }}>Settings</span>
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

          {/* Save Bar */}
          {dirty && (
            <div className="shrink-0 px-6 py-3 flex items-center justify-end gap-3 border-t"
              style={{ background: "#0A0D14", borderColor: "rgba(255,255,255,0.06)" }}>
              <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>
                Unsaved changes
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleApply}
                  disabled={saving}
                  className="px-4 py-1.5 text-[12px] font-medium rounded-lg transition-all cursor-pointer disabled:opacity-40"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(232,234,240,0.8)",
                  }}
                >
                  Apply
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 text-[12px] font-medium rounded-lg transition-all cursor-pointer disabled:opacity-40"
                  style={{
                    background: "#4F8CFF",
                    color: "#fff",
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
