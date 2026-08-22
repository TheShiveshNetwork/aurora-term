import React, { useState, useRef, useEffect } from "react";
import WindowSettingsView from "./WindowSettingsView";
import EditorSettingsView from "./EditorSettingsView";
import WorkspaceSettingsView from "./WorkspaceSettingsView";
import AppearanceSettingsView from "./AppearanceSettingsView";
import AISettingsView from "./AISettingsView";
import PermissionsSettingsView from "./PermissionsSettingsView";
import KeybindingsSettingsView from "./KeybindingsSettingsView";
import AboutSettingsView from "./AboutSettingsView";
import CloudSettingsView from "./CloudSettingsView";
import AccountsSettingsView from "./AccountsSettingsView";
import { ProviderDetailView } from "./ProviderDetailView";
import { Breadcrumbs, SettingsContext, DraftSettings } from "./SettingsShared";
import { ProviderName } from "@aurora/types";
import { ProviderRegistry } from "../../lib/providers";
import { ai, AppConfig, config, state } from "../../lib/ipc";
import { WindowControls } from "../ui/WindowControls";
import { emit, listen } from "@tauri-apps/api/event";
import { Button } from "../ui/Button";
import { useAppBootstrap } from "../../hooks/useAppBootstrap";
import { useNotificationStore } from "../../stores/useToastStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

// Event used to forward settings errors (save/apply failures) from the settings
// window to the main terminal window so the user sees them where they're working.
const SETTINGS_ERROR_EVENT = "aurora:settings-error";

interface SettingsTarget {
  section: string;
  sub: string;
  element?: string;
}

type SectionId = "general" | "agent" | "user" | "about";
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
      { id: "window", label: "Window", view: <WindowSettingsView /> },
      { id: "editor", label: "Editor", view: <EditorSettingsView /> },
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
      { id: "permissions", label: "Permissions", view: <PermissionsSettingsView /> },
    ],
  },
  {
    id: "user",
    label: "User",
    items: [
      { id: "account", label: "Account", view: <AccountsSettingsView /> },
      { id: "cloud", label: "Cloud", view: <CloudSettingsView /> },
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
  useAppBootstrap();
  const [nav, setNav] = useState<{ section: SectionId; sub: SubPageId }>({
    section: "general",
    sub: "window",
  });
  const [providerPage, setProviderPage] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSettings | null>(null);
  const [initial, setInitial] = useState<DraftSettings | null>(null);
  const [applied, setApplied] = useState<DraftSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [keyringStatus, setKeyringStatus] = useState<Record<string, boolean>>({});
  const contentRef = useRef<HTMLDivElement>(null);

  const refreshKeyringStatus = () => {
    ai.getProviderStatus().then(setKeyringStatus).catch(() => { });
  };

  const { section, sub } = nav;
  const activeSection = SECTIONS.find((s) => s.id === section)!;
  const activePage = activeSection.items.find((p) => p.id === sub) ?? activeSection.items[0];
  const providerBreadcrumb = providerPage
    ? ProviderRegistry.get(providerPage as ProviderName)?.displayName || providerPage
    : null;
  const breadcrumbItems = providerPage
    ? [
      "Settings",
      activeSection.label,
      { label: "AI Providers", onClick: () => setProviderPage(null) },
      providerBreadcrumb!,
    ]
    : ["Settings", activeSection.label, activePage.label];

  useEffect(() => {
    Promise.all([
      config.get(),
      state.get(),
    ]).then(([cfg, uiState]) => {
      const initialVal: DraftSettings = {
        config: cfg,
        sidebarCollapsed: uiState.sidebar_collapsed,
        showAiBar: uiState.show_ai_bar,
        chatInputOpen: uiState.chat_input_open,
        fileChatInputOpen: uiState.file_chat_input_open,
        tabBarVisible: uiState.tab_bar_visible,
      };
      setDraft(JSON.parse(JSON.stringify(initialVal)));
      setInitial(JSON.parse(JSON.stringify(initialVal)));
      setApplied(JSON.parse(JSON.stringify(initialVal)));
    }).catch(console.error);
    refreshKeyringStatus();
  }, []);

  useEffect(() => {
    let unlistenConfig: (() => void) | null = null;
    // Only keep the live working copy (`draft`) in sync with external config
    // changes. The saved baseline (`initial`) and the applied marker (`applied`)
    // are owned by Save/Apply respectively — otherwise emitting `config_changed`
    // from Apply would mark the draft as already-saved and hide both buttons.
    listen<AppConfig>("config_changed", (event) => {
      setDraft((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          config: event.payload,
        };
      });
    }).then((u) => {
      unlistenConfig = u;
    });

    let unlistenUiState: (() => void) | null = null;
    listen<{
      sidebarCollapsed: boolean;
      showAiBar: boolean;
      chatInputOpen: boolean;
      fileChatInputOpen: boolean;
      tabBarVisible: boolean;
    }>("ui_state_changed", (event) => {
      const { sidebarCollapsed, showAiBar, chatInputOpen, fileChatInputOpen, tabBarVisible } = event.payload;
      setDraft((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          sidebarCollapsed,
          showAiBar,
          chatInputOpen,
          fileChatInputOpen,
          tabBarVisible,
        };
      });
    }).then((u) => {
      unlistenUiState = u;
    });

    return () => {
      if (unlistenConfig) unlistenConfig();
      if (unlistenUiState) unlistenUiState();
    };
  }, []);

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
      await emit("config_changed", draft.config);
      await state.updateSidebar(
        draft.sidebarCollapsed,
        draft.tabBarVisible,
        draft.showAiBar,
        draft.chatInputOpen,
        draft.fileChatInputOpen
      );
      await emit("ui_state_changed", {
        sidebarCollapsed: draft.sidebarCollapsed,
        showAiBar: draft.showAiBar,
        chatInputOpen: draft.chatInputOpen,
        fileChatInputOpen: draft.fileChatInputOpen,
        tabBarVisible: draft.tabBarVisible,
      });
      // Re-read the canonical config so the applied snapshot matches what the live
      // app actually received (it may include project-level overrides from the
      // merge). This keeps `draft === applied` so the Apply button stays disabled.
      const appliedConfig = await config.get();
      const synced = JSON.parse(JSON.stringify({ ...draft, config: appliedConfig }));
      setDraft(synced);
      setApplied(synced);
    } catch (e) {
      console.error("Apply failed", e);
      useNotificationStore.getState().addNotification(e, "error");
      void emit(SETTINGS_ERROR_EVENT, e);
    }
    setApplying(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      // Local config changed → mark it as not-yet-synced so the cloud buttons
      // reflect pending changes without needing to query the backend.
      const configToSave: AppConfig = {
        ...draft.config,
        cloud: { ...(draft.config.cloud ?? { auto_sync: false }), synced: false },
      };
      await config.saveGlobal(configToSave);
      useSettingsStore.getState().setCloudSynced(false);
      await state.updateSidebar(
        draft.sidebarCollapsed,
        draft.tabBarVisible,
        draft.showAiBar,
        draft.chatInputOpen,
        draft.fileChatInputOpen
      );
      await emit("ui_state_changed", {
        sidebarCollapsed: draft.sidebarCollapsed,
        showAiBar: draft.showAiBar,
        chatInputOpen: draft.chatInputOpen,
        fileChatInputOpen: draft.fileChatInputOpen,
        tabBarVisible: draft.tabBarVisible,
      });
      // Re-read the canonical persisted config and sync every baseline to it. This
      // prevents the later `config_changed` round-trip (which re-merges with
      // project overrides) from re-diverging draft/initial and leaving the buttons
      // visible. After a successful save the footer disappears.
      const savedConfig = await config.get();
      const synced = JSON.parse(JSON.stringify({ ...draft, config: savedConfig }));
      setDraft(synced);
      setApplied(synced);
      setInitial(synced);
    } catch (e) {
      console.error("Save failed", e);
      useNotificationStore.getState().addNotification(e, "error");
      void emit(SETTINGS_ERROR_EVENT, e);
    }
    setSaving(false);
  };

  if (!draft || !initial) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "#0A0D14", color: "#E8EAF0" }} />
    );
  }

  // The `cloud` object is application-managed sync state (set automatically by
  // Upload/Revert and by saving), not a user-edited setting. Ignore it when
  // deciding whether the user has unsaved *settings* changes — otherwise the
  // automatic sync write (which flips `cloud.synced`) makes the Settings page
  // think it needs saving, creating a save↔sync loop.
  const normalized = (d: DraftSettings | null) => {
    if (!d) return "";
    const copy: any = JSON.parse(JSON.stringify(d));
    if (copy.config) delete copy.config.cloud;
    return JSON.stringify(copy);
  };

  const isDirty = !!(draft && initial && normalized(draft) !== normalized(initial));
  const saveDisabled = saving || applying || !draft || !initial || !isDirty;
  const applyDisabled = saving || applying || !draft || !applied || normalized(draft) === normalized(applied);
  const hasChanges = isDirty || !!(draft && applied && normalized(draft) !== normalized(applied));

  return (
    <SettingsContext.Provider value={{ draft, updateDraft, providerPage, setProviderPage }}>
      <div className="h-screen flex flex-col overflow-hidden select-none" style={{ background: "#0A0D14", color: "#E8EAF0" }}>
        <style>{`.setting-flash { outline: 2px solid rgba(79,140,255,0.4); outline-offset: -2px; border-radius: 8px; transition: outline-color 0.15s; }`}</style>
        <header
          data-tauri-drag-region
          className="flex items-center justify-between h-auto pl-3 shrink-0"
          style={{ background: "#0A0D14", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold tracking-wider select-none" style={{ color: "rgba(232,234,240,0.4)" }}>Aurora Settings</span>
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
                    const selected = sub === p.id || (p.id === "ai" && providerPage !== null);
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setNav({ section: sec.id, sub: p.id }); setProviderPage(null); }}
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
              {providerPage ? (
                <ProviderDetailView
                  name={providerPage as ProviderName}
                  isSelected={draft.config.ai.active_provider === providerPage}
                  keyringHasKey={!!keyringStatus[providerPage]}
                  onSetSelected={() => {
                    updateDraft((d) => { d.config.ai.active_provider = providerPage; });
                    setProviderPage(null);
                  }}
                  onClose={() => setProviderPage(null)}
                  onApiKeyChange={refreshKeyringStatus}
                />
              ) : (
                activePage.view
              )}
            </div>

            {/* Footer Bar */}
            {hasChanges && (
              <div className="shrink-0 px-6 py-3 flex items-center justify-end gap-3 border-t"
                style={{ background: "#0A0D14", borderColor: "rgba(255,255,255,0.06)" }}>
                {isDirty && (
                  <span className="text-[11px]" style={{ color: "rgba(232,234,240,0.35)" }}>
                    Unsaved changes
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleApply}
                    disabled={applyDisabled}
                    variant="secondary"
                    size="md"
                  >
                    {applying ? "Applying..." : "Apply"}
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={saveDisabled}
                    variant="primary"
                    size="md"
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </SettingsContext.Provider>
  );
}
