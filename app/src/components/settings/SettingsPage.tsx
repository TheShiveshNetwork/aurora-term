import React, { useEffect, useState } from "react";
import {
  X, Shield, Key, Sliders, Palette, Save,
  Monitor, Keyboard, Info, User, Eye,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ai } from "../../lib/ipc";
import { useAIStore } from "../../stores/useAIStore";
import { useSettingsStore, EditorThemeName } from "../../stores/useSettingsStore";
import { ProviderName } from "@aurora/types";

type SettingsCategory = "general" | "appearance" | "ai" | "keybindings" | "about";

const CATEGORIES: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <User size={14} /> },
  { id: "appearance", label: "Appearance", icon: <Eye size={14} /> },
  { id: "ai", label: "AI", icon: <Shield size={14} /> },
  { id: "keybindings", label: "Keybindings", icon: <Keyboard size={14} /> },
  { id: "about", label: "About", icon: <Info size={14} /> },
];

export default function SettingsPage() {
  const [category, setCategory] = useState<SettingsCategory>("general");

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none" style={{ background: "#0A0D14", color: "#E8EAF0" }}>
      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div
          className="w-48 shrink-0 flex flex-col py-3 overflow-y-auto"
          style={{ borderRight: "1px solid rgba(255,255,255,0.06)", background: "rgba(15,19,26,0.6)" }}
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className="flex items-center gap-2.5 px-4 py-2 text-[12px] text-left transition-all cursor-pointer"
              style={{
                color: category === cat.id ? "#E8EAF0" : "rgba(232,234,240,0.45)",
                background: category === cat.id ? "rgba(79,140,255,0.08)" : "transparent",
                borderRight: category === cat.id ? "2px solid #4F8CFF" : "2px solid transparent",
              }}
              onMouseEnter={(e) => { if (category !== cat.id) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { if (category !== cat.id) e.currentTarget.style.background = "transparent"; }}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {category === "general" && <GeneralSettings />}
          {category === "appearance" && <AppearanceSettings />}
          {category === "ai" && <AISettings />}
          {category === "keybindings" && <KeybindingsSettings />}
          {category === "about" && <AboutSettings />}
        </div>
      </div>
    </div>
  );
}

/* ── General ─────────────────────────────────────────── */
function GeneralSettings() {
  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    cursorStyle, setCursorStyle,
    cursorBlink, setCursorBlink,
    compactUi, setCompactUi,
    showStatusbar, setShowStatusbar,
  } = useSettingsStore();

  return (
    <div className="space-y-5 max-w-lg">
      <SectionTitle>General</SectionTitle>

      <FieldRow label="Font Family">
        <input
          type="text"
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          className="flex-1 bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-text select-text"
          style={{ color: "#E8EAF0" }}
        />
      </FieldRow>

      <FieldRow label="Font Size">
        <input
          type="number"
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          min={10}
          max={32}
          className="w-20 bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-text select-text"
          style={{ color: "#E8EAF0" }}
        />
      </FieldRow>

      <FieldRow label="Cursor Style">
        <select
          value={cursorStyle}
          onChange={(e) => setCursorStyle(e.target.value as any)}
          className="bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-pointer"
          style={{ color: "#E8EAF0", minWidth: "120px" }}
        >
          <option value="block">Block</option>
          <option value="underline">Underline</option>
          <option value="bar">Bar</option>
        </select>
      </FieldRow>

      <FieldRow label="Cursor Blink">
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={cursorBlink} onChange={() => setCursorBlink(!cursorBlink)} className="sr-only peer" />
          <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: cursorBlink ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
            <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${cursorBlink ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
          </div>
        </label>
      </FieldRow>

      <FieldRow label="Compact UI">
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={compactUi} onChange={() => setCompactUi(!compactUi)} className="sr-only peer" />
          <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: compactUi ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
            <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${compactUi ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
          </div>
        </label>
      </FieldRow>

      <FieldRow label="Show Status Bar">
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={showStatusbar} onChange={() => setShowStatusbar(!showStatusbar)} className="sr-only peer" />
          <div className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary" style={{ background: showStatusbar ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}>
            <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${showStatusbar ? "translate-x-4" : "translate-x-0.5"}`} style={{ marginTop: "1px" }} />
          </div>
        </label>
      </FieldRow>
    </div>
  );
}

/* ── Appearance ──────────────────────────────────────── */
function AppearanceSettings() {
  const { theme, setTheme, editorTheme, setEditorTheme } = useSettingsStore();

  return (
    <div className="space-y-5 max-w-lg">
      <SectionTitle>Appearance</SectionTitle>

      <FieldRow label="Theme">
        <div className="flex gap-2">
          <button
            onClick={() => setTheme("dark")}
            className="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all cursor-pointer"
            style={{
              background: theme === "dark" ? "#4F8CFF" : "rgba(255,255,255,0.06)",
              color: theme === "dark" ? "#000" : "rgba(232,234,240,0.6)",
              border: theme === "dark" ? "none" : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Dark
          </button>
          <button
            onClick={() => setTheme("light")}
            className="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all cursor-pointer"
            style={{
              background: theme === "light" ? "#4F8CFF" : "rgba(255,255,255,0.06)",
              color: theme === "light" ? "#000" : "rgba(232,234,240,0.6)",
              border: theme === "light" ? "none" : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Light
          </button>
        </div>
      </FieldRow>

      <FieldRow label="Editor Theme">
        <select
          value={editorTheme}
          onChange={(e) => setEditorTheme(e.target.value as EditorThemeName)}
          className="bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-pointer select-none"
          style={{ color: "#E8EAF0", minWidth: "160px" }}
        >
          {THEME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </FieldRow>
    </div>
  );
}

/* ── AI ──────────────────────────────────────────────── */
function AISettings() {
  const { activeProvider, providers, setActiveProvider } = useAIStore();
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [keyringStatus, setKeyringStatus] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await ai.getProviderStatus();
        setKeyringStatus(status);
      } catch (err) {
        console.error("Failed to fetch keyring status:", err);
      }
    };
    fetchStatus();
  }, []);

  const handleSaveKey = async (provider: ProviderName) => {
    const key = providerKeys[provider];
    if (!key) return;
    try {
      await ai.saveApiKey(provider, key);
      setKeyringStatus((prev) => ({ ...prev, [provider]: true }));
      setProviderKeys((prev) => ({ ...prev, [provider]: "" }));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteKey = async (provider: ProviderName) => {
    try {
      await ai.deleteApiKey(provider);
      setKeyringStatus((prev) => ({ ...prev, [provider]: false }));
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestConnection = async (provider: ProviderName) => {
    setTesting((prev) => ({ ...prev, [provider]: true }));
    try {
      await ai.testProvider(provider);
    } catch (err) {
      console.error(err);
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <div className="space-y-5 max-w-lg">
      <SectionTitle>AI Engines</SectionTitle>

      {(Object.keys(providers) as ProviderName[]).map((name) => {
        const config = providers[name];
        const hasKey = keyringStatus[name];
        const isSelected = activeProvider === name;

        return (
          <div
            key={name}
            className="p-4 rounded-xl border transition-all"
            style={{
              border: isSelected ? "1px solid rgba(79,140,255,0.3)" : "1px solid rgba(255,255,255,0.06)",
              background: isSelected ? "rgba(79,140,255,0.05)" : "rgba(15,19,26,0.3)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="active-provider"
                  checked={isSelected}
                  onChange={() => setActiveProvider(name)}
                  className="cursor-pointer"
                  style={{ accentColor: "#4F8CFF" }}
                />
                <span className="text-[12px] font-bold capitalize" style={{ color: "#E8EAF0" }}>
                  {name} {name === "ollama" && <span className="text-[10px] opacity-60">(Local)</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {name !== "ollama" && (
                  <span
                    className="text-[9px] uppercase px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      color: hasKey ? "#42C6FF" : "#FF6B6B",
                      background: hasKey ? "rgba(66,198,255,0.1)" : "rgba(255,107,107,0.1)",
                      border: hasKey ? "1px solid rgba(66,198,255,0.2)" : "1px solid rgba(255,107,107,0.2)",
                    }}
                  >
                    {hasKey ? "Key Configured" : "No Key"}
                  </span>
                )}
                <button
                  onClick={() => handleTestConnection(name)}
                  disabled={testing[name]}
                  className="text-[10px] px-2.5 py-1 rounded transition-colors cursor-pointer"
                  style={{
                    background: "rgba(15,19,26,0.5)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "rgba(232,234,240,0.6)",
                  }}
                >
                  {testing[name] ? "Testing..." : "Test Link"}
                </button>
              </div>
            </div>

            {name !== "ollama" && (
              <div className="flex items-center gap-2 mt-2">
                <div className="relative flex-1">
                  <Key size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(232,234,240,0.35)" }} />
                  <input
                    type="password"
                    value={providerKeys[name] || ""}
                    onChange={(e) => setProviderKeys((prev) => ({ ...prev, [name]: e.target.value }))}
                    placeholder={hasKey ? "••••••••••••••••••••••••" : "Enter API Key..."}
                    className="w-full rounded-lg pl-7 pr-3 py-1.5 text-[12px] outline-none cursor-text select-text"
                    style={{
                      background: "#0A0D14",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: "#E8EAF0",
                    }}
                  />
                </div>
                <button
                  onClick={() => handleSaveKey(name)}
                  className="p-1.5 rounded-lg transition-colors cursor-pointer"
                  style={{
                    background: "rgba(79,140,255,0.15)",
                    color: "#4F8CFF",
                  }}
                >
                  <Save size={14} />
                </button>
                {hasKey && (
                  <button
                    onClick={() => handleDeleteKey(name)}
                    className="text-[10px] px-2.5 py-2 rounded font-bold transition-colors cursor-pointer"
                    style={{
                      background: "rgba(255,107,107,0.1)",
                      color: "#FF6B6B",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 mt-3 text-[10px] font-mono" style={{ color: "rgba(232,234,240,0.45)" }}>
              <div>Fast: <span className="opacity-60">{config.fastModel}</span></div>
              <div>Balanced: <span className="opacity-60">{config.balancedModel}</span></div>
              <div>Powerful: <span className="opacity-60">{config.powerfulModel}</span></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Keybindings ─────────────────────────────────────── */
function KeybindingsSettings() {
  return (
    <div className="space-y-5 max-w-lg">
      <SectionTitle>Keybindings</SectionTitle>
      <p className="text-[12px] leading-relaxed" style={{ color: "rgba(232,234,240,0.45)" }}>
        Keyboard shortcuts are defined in your config file. Edit <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "rgba(255,255,255,0.05)" }}>config.toml</code> to customize bindings.
      </p>
    </div>
  );
}

/* ── About ────────────────────────────────────────────── */
function AboutSettings() {
  return (
    <div className="space-y-5 max-w-lg">
      <SectionTitle>About</SectionTitle>
      <div className="space-y-2 text-[12px]" style={{ color: "rgba(232,234,240,0.6)" }}>
        <p><span className="font-semibold" style={{ color: "#E8EAF0" }}>Aurora</span> — Hardware-accelerated, AI-native developer terminal.</p>
        <p>GPU-rendered blocks, multi-provider AI routing.</p>
        <p className="pt-2" style={{ color: "rgba(232,234,240,0.35)" }}>Built with Tauri v2, React, and Rust.</p>
      </div>
    </div>
  );
}

/* ── Shared components ───────────────────────────────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <span className="text-[13px] font-semibold" style={{ color: "#E8EAF0" }}>{children}</span>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px]" style={{ color: "rgba(232,234,240,0.65)" }}>{label}</span>
      <div className="flex items-center gap-2">
        {children}
      </div>
    </div>
  );
}

const THEME_OPTIONS: { value: EditorThemeName; label: string }[] = [
  { value: "dracula", label: "Dracula" },
  { value: "one-dark", label: "One Dark" },
  { value: "atomone", label: "Atom One" },
  { value: "bespin", label: "Bespin" },
  { value: "github", label: "GitHub Dark" },
  { value: "material", label: "Material" },
  { value: "monokai", label: "Monokai" },
  { value: "nord", label: "Nord" },
  { value: "okaidia", label: "Okaidia" },
  { value: "solarized", label: "Solarized Dark" },
  { value: "tokyo-night", label: "Tokyo Night" },
  { value: "vscode", label: "VS Code Dark" },
  { value: "xcode", label: "Xcode Dark" },
];
