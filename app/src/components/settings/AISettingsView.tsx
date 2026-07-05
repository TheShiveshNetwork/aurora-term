import React, { useContext } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { SettingsContext } from "./SettingsShared";
import { ProviderName } from "@aurora/types";
import { ProviderRegistry } from "../../lib/providers";
import { ProviderSelector } from "./ProviderSelector";
import { ProviderIcon } from "./ProviderIcon";

export default function AISettingsView() {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft, providerPage, setProviderPage } = context;

  const activeProvider = draft.config.ai.active_provider as ProviderName;
  const providerNames = ProviderRegistry.getIds();

  const handleSetSelected = (name: ProviderName) => {
    updateDraft((d) => {
      d.config.ai.active_provider = name;
    });
  };

  return (
    <div className="space-y-6 text-sm" id="setting-ai-providers">
      <div>
        <h2 className="text-xl font-semibold text-white tracking-tight">AI Providers</h2>
        <p className="text-xs text-white/40 mt-1">Manage the AI providers Aurora can use.</p>
      </div>

      <div className="space-y-2" id="setting-default-provider">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Selected Provider</h3>
        <ProviderSelector
          providers={providerNames}
          activeProvider={activeProvider}
          onChange={handleSetSelected}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">All Providers</h3>
        <div className="space-y-2">
          {providerNames.map((name) => {
            const info = ProviderRegistry.get(name);
            const isSelected = name === activeProvider;
            const isExpanded = providerPage === name;

            return (
              <div key={name}>
                <button
                  onClick={() => setProviderPage(isExpanded ? null : name)}
                  className={`flex items-center justify-between w-full p-3 rounded-xl border transition-all cursor-pointer text-left ${
                    isExpanded
                      ? "border-white/[0.08] bg-[#1c202a]/80"
                      : "border-white/[0.04] bg-[#161920]/40 hover:bg-[#1c202a]/60"
                    } ${isSelected ? "ring-1 ring-blue-500/20" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.02] border border-white/[0.04] shrink-0">
                      <ProviderIcon name={name} size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#E8EAF0]">{info.displayName}</span>
                        {isSelected && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium tracking-wide bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            Selected
                          </span>
                        )}
                        {!info.requiresApiKey && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium tracking-wide bg-white/5 text-white/50 border border-white/10">
                            Local
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ChevronRight
                      size={15}
                      className={`text-white/30 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 text-xs text-white/40">
        <Sparkles size={14} className="text-white/30" />
        <span>Aurora will use the selected provider for all AI features.</span>
      </div>
    </div>
  );
}
