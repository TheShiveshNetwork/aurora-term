import React, { useState, useEffect } from "react";
import { ProviderName, ProviderConfig } from "@aurora/types";
import { ProviderIcon, DISPLAY_NAMES } from "./ProviderIcon";
import { ai } from "../../lib/ipc";

interface ProviderDetailViewProps {
  name: ProviderName;
  config: ProviderConfig;
  isDefault: boolean;
  keyringHasKey: boolean;
  onSetDefault: () => void;
  onClose: () => void;
}

export function ProviderDetailView({
  name,
  config,
  isDefault,
  keyringHasKey,
  onSetDefault,
  onClose,
}: ProviderDetailViewProps) {
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"idle" | "success" | "error">("idle");
  const [fastModel, setFastModel] = useState(config.fastModel);
  const [balancedModel, setBalancedModel] = useState(config.balancedModel);
  const [powerfulModel, setPowerfulModel] = useState(config.powerfulModel);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || "");

  useEffect(() => {
    setFastModel(config.fastModel);
    setBalancedModel(config.balancedModel);
    setPowerfulModel(config.powerfulModel);
    setBaseUrl(config.baseUrl || "");
  }, [config]);

  if (!config) return null;

  const handleSaveKey = async () => {
    if (!apiKey) return;
    try {
      await ai.saveApiKey(name, apiKey);
      setApiKey("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteKey = async () => {
    try {
      await ai.deleteApiKey(name);
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult("idle");
    try {
      await ai.testProvider(name);
      setTestResult("success");
    } catch {
      setTestResult("error");
    } finally {
      setTesting(false);
    }
  };

  const handleSetDefault = () => {
    onSetDefault();
    onClose();
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#161920]/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.02] border border-white/[0.04]">
            <ProviderIcon name={name} size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#E8EAF0]">{DISPLAY_NAMES[name]}</span>
              {isDefault && (
                <span className="text-[10px] px-2 py-0.5 rounded-md font-medium tracking-wide bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Default
                </span>
              )}
            </div>
            <span className={`text-[11px] ${keyringHasKey ? "text-green-400/60" : "text-red-400/60"}`}>
              {keyringHasKey ? "API key configured" : "No API key"}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] transition-all cursor-pointer text-white/30 hover:text-white/60"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* API Key */}
        {name !== "ollama" && (
          <div>
            <label className="text-[11px] font-medium text-[#E8EAF0]/50 uppercase tracking-wider block mb-1.5">
              API Key
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyringHasKey ? "••••••••••••••••" : `Enter ${DISPLAY_NAMES[name]} API key`}
                className="flex-1 bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-text select-text"
                style={{ color: "#E8EAF0" }}
              />
              <button
                onClick={handleSaveKey}
                disabled={!apiKey}
                className="px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20"
              >
                Save
              </button>
              {keyringHasKey && (
                <button
                  onClick={handleDeleteKey}
                  className="px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all cursor-pointer bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}

        {name === "ollama" && (
          <div className="text-[12px] text-[#E8EAF0]/40 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            Ollama runs locally — no API key required.
          </div>
        )}

        {/* Base URL */}
        <div>
          <label className="text-[11px] font-medium text-[#E8EAF0]/50 uppercase tracking-wider block mb-1.5">
            Base URL
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              name === "ollama"
                ? "http://localhost:11434"
                : name === "nvidia"
                  ? "https://integrate.api.nvidia.com/v1"
                  : "https://api.openai.com/v1"
            }
            className="w-full bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-text select-text font-mono"
            style={{ color: "#E8EAF0" }}
          />
        </div>

        {/* Model Overrides */}
        <div>
          <label className="text-[11px] font-medium text-[#E8EAF0]/50 uppercase tracking-wider block mb-1.5">
            Model Overrides
          </label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-[#E8EAF0]/40 block mb-0.5">Fast</label>
              <input
                type="text"
                value={fastModel}
                onChange={(e) => setFastModel(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-2.5 py-1.5 text-[11px] outline-none cursor-text select-text font-mono"
                style={{ color: "#E8EAF0" }}
              />
            </div>
            <div>
              <label className="text-[10px] text-[#E8EAF0]/40 block mb-0.5">Balanced</label>
              <input
                type="text"
                value={balancedModel}
                onChange={(e) => setBalancedModel(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-2.5 py-1.5 text-[11px] outline-none cursor-text select-text font-mono"
                style={{ color: "#E8EAF0" }}
              />
            </div>
            <div>
              <label className="text-[10px] text-[#E8EAF0]/40 block mb-0.5">Powerful</label>
              <input
                type="text"
                value={powerfulModel}
                onChange={(e) => setPowerfulModel(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-2.5 py-1.5 text-[11px] outline-none cursor-text select-text font-mono"
                style={{ color: "#E8EAF0" }}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all cursor-pointer disabled:opacity-40 bg-white/[0.04] text-[#E8EAF0]/60 border border-white/[0.06] hover:bg-white/[0.08]"
          >
            {testing ? (
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 4" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
            )}
            {testing ? "Testing..." : "Test Connection"}
          </button>

          {testResult === "success" && (
            <span className="text-[11px] text-green-400/80">Connected</span>
          )}
          {testResult === "error" && (
            <span className="text-[11px] text-red-400/80">Connection failed</span>
          )}

          {!isDefault && (
            <button
              onClick={handleSetDefault}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all cursor-pointer bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 ml-auto"
            >
              Set as Default
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
