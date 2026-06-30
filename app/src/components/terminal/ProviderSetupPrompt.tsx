import { useAIStore } from "../../stores/useAIStore";
import { ProviderName } from "@aurora/types";
import { ProviderIcon, DISPLAY_NAMES } from "../settings/ProviderIcon";
import { openSettingsWindow } from "../../lib/settings";

const API_PROVIDERS: ProviderName[] = ["anthropic", "openai", "gemini", "groq", "nvidia"];

export function useHasApiKeyConfigured() {
  const providers = useAIStore((s) => s.providers);
  return API_PROVIDERS.some((name) => providers[name]?.hasApiKey);
}

export function ProviderSetupPrompt({ compact }: { compact?: boolean }) {
  const handleOpenSettings = () => {
    openSettingsWindow({ section: "ai", sub: "providers" });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-6 text-center select-text">
      <div
        className={`rounded-2xl ${compact ? "p-4" : "p-6"} w-full max-w-sm`}
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex items-center justify-center gap-1.5 mb-3">
          {API_PROVIDERS.slice(0, 3).map((name) => (
            <div
              key={name}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <ProviderIcon name={name} size={16} />
            </div>
          ))}
        </div>

        <p className={`font-semibold ${compact ? "text-[12px]" : "text-[13px]"}`} style={{ color: "#E8EAF0" }}>
          No AI provider configured
        </p>
        <p className={`mt-1.5 leading-relaxed ${compact ? "text-[10px]" : "text-[11px]"}`} style={{ color: "rgba(232,234,240,0.45)" }}>
          Add an API key for any supported provider in Settings to start using the agent.
        </p>

        <div className="flex flex-wrap gap-1.5 justify-center mt-3">
          {API_PROVIDERS.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "rgba(232,234,240,0.55)",
              }}
            >
              <ProviderIcon name={name} size={10} />
              {DISPLAY_NAMES[name]}
            </span>
          ))}
        </div>

        <button
          onClick={handleOpenSettings}
          className={`mt-4 w-full flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-all cursor-pointer ${
            compact ? "text-[10px] py-1.5 px-3" : "text-[11px] py-2 px-4"
          }`}
          style={{
            background: "rgba(79,140,255,0.12)",
            border: "1px solid rgba(79,140,255,0.25)",
            color: "#4F8CFF",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.18)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.12)")}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Open Settings
        </button>
      </div>
    </div>
  );
}
