import React, { createContext } from "react";
import { EditorThemeName } from "../../stores/useSettingsStore";
import type { AppConfig } from "../../lib/ipc";

export interface DraftSettings {
  config: AppConfig;
  sidebarCollapsed: boolean;
  showAiBar: boolean;
  chatInputOpen: boolean;
  fileChatInputOpen: boolean;
  tabBarVisible: boolean;
}

export interface SettingsContextType {
  draft: DraftSettings;
  updateDraft: (updater: (prev: DraftSettings) => void) => void;
  providerPage: string | null;
  setProviderPage: (name: string | null) => void;
}

export const SettingsContext = createContext<SettingsContextType | null>(null);


export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-white/6">
      <span className="text-[13px] font-semibold text-on-surface">{children}</span>
    </div>
  );
}

export function FieldRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] text-on-surface/65">{label}</span>
        {description && (
          <span className="text-[10px] text-on-surface/35">{description}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {children}
      </div>
    </div>
  );
}

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export function Breadcrumbs({ items }: { items: (string | BreadcrumbItem)[] }) {
  const resolved: BreadcrumbItem[] = items.map((item) =>
    typeof item === "string" ? { label: item } : item
  );

  return (
    <div className="flex items-center gap-1.5 text-[11px] mb-5 select-none text-on-surface/35">
      {resolved.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
              <path d="M3.5 2L6.5 5l-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {item.onClick ? (
            <button
              onClick={item.onClick}
              className="hover:text-[#E8EAF0]/80 transition-colors cursor-pointer"
            >
              {item.label}
            </button>
          ) : (
            <span className={i === resolved.length - 1 ? "text-[#E8EAF0]/60" : ""}>{item.label}</span>
          )}
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
