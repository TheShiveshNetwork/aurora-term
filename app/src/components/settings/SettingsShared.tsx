import React, { createContext } from "react";
import { EditorThemeName } from "../../stores/useSettingsStore";
import type { AppConfig } from "../../lib/ipc";

export interface DraftSettings {
  config: AppConfig;
  sidebarCollapsed: boolean;
  showAiBar: boolean;
  chatInputOpen: boolean;
  tabBarVisible: boolean;
}

export interface SettingsContextType {
  draft: DraftSettings;
  updateDraft: (updater: (prev: DraftSettings) => void) => void;
}

export const SettingsContext = createContext<SettingsContextType | null>(null);


export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <span className="text-[13px] font-semibold" style={{ color: "#E8EAF0" }}>{children}</span>
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px]" style={{ color: "rgba(232,234,240,0.65)" }}>{label}</span>
      <div className="flex items-center gap-2">
        {children}
      </div>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: string[] }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] mb-5 select-none" style={{ color: "rgba(232,234,240,0.35)" }}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3.5 2L6.5 5l-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className={i === items.length - 1 ? "text-[#E8EAF0]/60" : ""}>{item}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export const THEME_OPTIONS: { value: EditorThemeName; label: string }[] = [
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
