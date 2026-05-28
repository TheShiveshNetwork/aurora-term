import React, { useEffect, useState } from "react";
import { X, Shield, Key, Sliders, Cpu, Save } from "lucide-react";
import { ai } from "../../lib/ipc";
import { useAIStore } from "../../stores/useAIStore";
import { ProviderName } from "../../types/ai";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { activeProvider, providers, setActiveProvider, updateProviderConfig } = useAIStore();
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [keyringStatus, setKeyringStatus] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Fetch API key presence status from Rust keyring
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
      alert(`API Key for ${provider} saved securely in OS Keychain.`);
    } catch (err) {
      console.error(err);
      alert("Failed to save API key securely.");
    }
  };

  const handleDeleteKey = async (provider: ProviderName) => {
    try {
      await ai.deleteApiKey(provider);
      setKeyringStatus((prev) => ({ ...prev, [provider]: false }));
      alert(`API Key for ${provider} removed from OS Keychain.`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestConnection = async (provider: ProviderName) => {
    setTesting((prev) => ({ ...prev, [provider]: true }));
    try {
      const ok = await ai.testProvider(provider);
      alert(ok ? `Successfully connected to ${provider}!` : `Connection to ${provider} failed.`);
    } catch (err) {
      console.error(err);
      alert(`Connection failed: ${err}`);
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <div className="fixed inset-0 bg-surface-container-lowest/80 backdrop-blur-md flex items-center justify-center z-[100] animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-surface-container-high border border-outline-variant/20 rounded-xl shadow-2xl overflow-hidden glass-panel flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10 bg-surface-container-high/40">
          <div className="flex items-center gap-2.5 text-primary">
            <Sliders size={16} className="text-primary-container" />
            <span className="font-headline-md text-headline-md tracking-tight">System Settings</span>
          </div>
          <button
            onClick={onClose}
            className="text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-variant/20 rounded p-1 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Tabs area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-outline-variant/10 pb-1.5 text-on-surface font-semibold text-[13px]">
              <Shield size={14} className="text-secondary" />
              <span>AI ENGINES CREDENTIALS</span>
            </div>

            {/* Provider settings list */}
            {(Object.keys(providers) as ProviderName[]).map((name) => {
              const config = providers[name];
              const hasKey = keyringStatus[name];
              const isSelected = activeProvider === name;

              return (
                <div
                  key={name}
                  className={`p-4 rounded-xl border transition-all ${isSelected
                    ? "border-primary/30 bg-primary/5"
                    : "border-outline-variant/10 bg-surface-container/20 hover:bg-surface-container/40"
                    }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="active-provider"
                        checked={isSelected}
                        onChange={() => setActiveProvider(name)}
                        className="text-primary focus:ring-0 cursor-pointer"
                      />
                      <span className="capitalize font-bold text-code-base text-on-surface select-none">
                        {name} {name === "ollama" && <span className="text-[10px] text-tertiary-fixed-dim uppercase">(Local)</span>}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {name !== "ollama" && (
                        <span className={`text-[9px] font-label-caps uppercase px-2 py-0.5 rounded-full ${hasKey
                          ? "bg-tertiary/10 text-tertiary border border-tertiary/20"
                          : "bg-error/10 text-error border border-error/20"
                          }`}>
                          {hasKey ? "Key Configured" : "No Key"}
                        </span>
                      )}
                      <button
                        onClick={() => handleTestConnection(name)}
                        disabled={testing[name]}
                        className="text-[10px] px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest transition-colors border border-outline-variant/10 text-on-surface-variant"
                      >
                        {testing[name] ? "Testing..." : "Test Link"}
                      </button>
                    </div>
                  </div>

                  {/* Masked Key inputs */}
                  {name !== "ollama" && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="relative flex-1">
                        <Key size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outline/40" />
                        <input
                          type="password"
                          value={providerKeys[name] || ""}
                          onChange={(e) =>
                            setProviderKeys((prev) => ({ ...prev, [name]: e.target.value }))
                          }
                          placeholder={hasKey ? "••••••••••••••••••••••••" : "Enter API Key..."}
                          className="w-full bg-surface-container-lowest border border-outline-variant/10 rounded-lg pl-7 pr-3 py-1.5 text-code-sm placeholder:text-outline/30 outline-none"
                        />
                      </div>
                      <button
                        onClick={() => handleSaveKey(name)}
                        className="p-1.5 rounded-lg bg-primary-container text-on-primary hover:bg-primary-container/80 transition-colors"
                        title="Save key securely"
                      >
                        <Save size={14} />
                      </button>
                      {hasKey && (
                        <button
                          onClick={() => handleDeleteKey(name)}
                          className="text-[10px] px-2.5 py-2 rounded bg-error/10 text-error hover:bg-error/20 transition-all font-bold"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}

                  {/* Model settings override */}
                  <div className="grid grid-cols-3 gap-2 mt-3 text-[10px] text-on-surface-variant/70 font-mono">
                    <div>Fast: <span className="opacity-60">{config.fastModel}</span></div>
                    <div>Balanced: <span className="opacity-60">{config.balancedModel}</span></div>
                    <div>Powerful: <span className="opacity-60">{config.powerfulModel}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-container-lowest/50 border-t border-outline-variant/10 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary-container text-on-primary font-mono text-[11px] font-bold rounded-lg hover:bg-primary-container/80 transition-colors"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
