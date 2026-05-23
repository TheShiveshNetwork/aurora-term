import React from "react";
import { Terminal, Plus, X } from "lucide-react";
import { useSessionStore } from "../../stores/useSessionStore";
import { Tab } from "../../types/session";

interface TabBarProps {
  onAddTab: () => void;
  onKillTab: (id: string) => void;
}

export function TabBar({ onAddTab, onKillTab }: TabBarProps) {
  const { tabs, activeTabId, setActiveTabId } = useSessionStore();

  return (
    <div className="flex items-center w-full px-3 py-2 bg-background border-b border-outline-variant/5">
      <div className="flex items-center flex-1 gap-2 overflow-x-auto no-scrollbar w-full">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`safari-tab flex-grow select-none ${isActive ? "active" : ""}`}
            >
              <Terminal size={12} className={isActive ? "text-outline" : "text-outline/70"} />
              <span className="truncate">{tab.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onKillTab(tab.id);
                }}
                className="ml-auto hover:bg-surface-variant/40 rounded p-0.5 transition-colors shrink-0 text-on-surface-variant/40 hover:text-error"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button
          onClick={onAddTab}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-variant/20 hover:text-primary transition-colors ml-auto border border-outline-variant/10"
          title="New Tab"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
