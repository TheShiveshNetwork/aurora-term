import { useState, useContext, useEffect, useMemo } from "react";
import { Copy, Check, RefreshCw, Trash } from "lucide-react";
import { ProviderName, ModelInfo } from "@aurora/types";
import { ProviderRegistry } from "../../lib/providers";
import { ProviderIcon } from "./ProviderIcon";
import { Input, ComboboxOption } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { ai } from "../../lib/ipc";
import { SettingsContext } from "./SettingsShared";
import { Button } from "../ui/Button";

interface ProviderDetailViewProps {
  name: ProviderName;
  isSelected: boolean;
  keyringHasKey: boolean;
  onSetSelected: () => void;
  onClose: () => void;
  onApiKeyChange?: () => void;
  onApiKeyError?: (msg: string) => void;
}

export function ProviderDetailView({
  name,
  isSelected,
  keyringHasKey,
  onSetSelected,
  onClose,
  onApiKeyChange,
  onApiKeyError,
}: ProviderDetailViewProps) {
  const context = useContext(SettingsContext);
  if (!context) return null;
  const { draft, updateDraft } = context;

  const config = (draft.config.ai as any)[name];
  if (!config) return null;

  const providerInfo = ProviderRegistry.get(name);

  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [keyNeeded, setKeyNeeded] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"idle" | "success" | "error">("idle");
  const [editingBaseUrl, setEditingBaseUrl] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const fastModel = config.fast_model || "";
  const balancedModel = config.balanced_model || "";
  const powerfulModel = config.powerful_model || "";
  const baseUrl = config.base_url || "";
  const hasBaseUrl = config.base_url !== null && config.base_url !== undefined;

  const modelOptions = useMemo<ComboboxOption[]>(
    () => models.map((m) => ({ id: m.id, label: m.display_name })),
    [models]
  );

  const fetchModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const result = await ai.fetchModels(name);
      setModels(result);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : null);
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, [name]);

  useEffect(() => {
    if (keyringHasKey) {
      ai.getApiKey(name).then(setApiKey).catch(() => setApiKey(""));
    } else {
      setApiKey("");
    }
  }, [name, keyringHasKey]);

  const handleSaveKey = async () => {
    if (!apiKey) return;
    try {
      await ai.saveApiKey(name, apiKey);
      onApiKeyChange?.();
    } catch (err) {
      onApiKeyError?.(`Failed to save API key: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      onApiKeyError?.(`Failed to copy: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDeleteKey = async () => {
    try {
      await ai.deleteApiKey(name);
      setApiKey("");
      setConfirmRemove(false);
      onApiKeyChange?.();
    } catch (err) {
      setConfirmRemove(false);
      onApiKeyError?.(`Failed to remove API key: ${err instanceof Error ? err.message : "Unknown error"}`);
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

  const handleSetSelected = () => {
    if (providerInfo.requiresApiKey && !keyringHasKey) {
      setKeyNeeded(true);
      return;
    }
    onSetSelected();
    onClose();
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.02] border border-white/[0.04]">
            <ProviderIcon name={name} size={18} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#E8EAF0]">{providerInfo.displayName}</span>
              {isSelected && (
                <span className="text-[10px] px-2 py-0.5 rounded-md font-medium tracking-wide bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Selected
                </span>
              )}
            </div>
            {providerInfo.requiresApiKey ? (
              <span className={`text-xs ${keyringHasKey ? "text-green-400/60" : "text-red-400/60"}`}>
                {keyringHasKey ? "API key configured" : "No API key"}
              </span>
            ) : (
              <span className="text-xs text-green-400/60">Available</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isSelected && (
            <Button
              variant="primary"
              onClick={handleSetSelected}
            >
              Set as default
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* API Key */}
        {providerInfo.requiresApiKey && (
          <div>
            <label className="text-xs font-medium text-[#E8EAF0]/50 tracking-wider block mb-1.5">
              API Key
            </label>
            <div className="flex items-center gap-2">
              <div className={`flex-1 rounded-[8px] transition-all duration-200 ${keyNeeded ? "ring-1 ring-error" : ""}`}>
                <Input
                  variant="secret"
                  value={apiKey}
                  onChange={(val) => { setApiKey(val); if (keyNeeded) setKeyNeeded(false); }}
                  placeholder={keyringHasKey ? "••••••••••••••••" : `Enter ${providerInfo.displayName} API key`}
                />
              </div>
              <Button
                onClick={handleCopyKey}
                variant="secondary"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
              {keyringHasKey && (
                <Button
                  onClick={() => setConfirmRemove(true)}
                  variant="secondary"
                >
                  <Trash size={14} />
                </Button>
              )}
            </div>
          </div>
        )}

        {!providerInfo.requiresApiKey && (
          <div className="text-[12px] text-[#E8EAF0]/40 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            {providerInfo.displayName} runs locally — no API key required.
          </div>
        )}

        {/* Base URL */}
        {providerInfo.editableBaseUrl && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[#E8EAF0]/50 tracking-wider">
                Base URL
              </label>
              <button
                onClick={() => setEditingBaseUrl(!editingBaseUrl)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-all cursor-pointer bg-white/[0.04] text-[#E8EAF0]/50 border border-white/[0.06] hover:bg-white/[0.08]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
                {editingBaseUrl ? "Done" : "Edit"}
              </button>
            </div>
            {editingBaseUrl ? (
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => updateDraft((d) => {
                  const p = (d.config.ai as any)[name];
                  if (p) p.base_url = e.target.value || null;
                })}
                placeholder={providerInfo.defaultBaseUrl || ""}
                className="w-full bg-surface-container-lowest border border-outline-variant/10 rounded-lg px-3 py-1.5 text-[12px] outline-none cursor-text select-text font-mono"
                style={{ color: "#E8EAF0" }}
              />
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono rounded-lg bg-white/[0.02] border border-white/[0.04]" style={{ color: "#E8EAF0" }}>
                <span className="text-[#E8EAF0]/40 mr-1">{">"}</span>
                {baseUrl || providerInfo.defaultBaseUrl || ""}
              </div>
            )}
          </div>
        )}

        {/* Model Overrides */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-[#E8EAF0]/50 tracking-wider">
              Model Overrides
            </label>
            <button
              onClick={fetchModels}
              disabled={loadingModels}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-all cursor-pointer disabled:opacity-40 bg-white/[0.04] text-[#E8EAF0]/50 border border-white/[0.06] hover:bg-white/[0.08]"
            >
              <RefreshCw size={10} className={loadingModels ? "animate-spin" : ""} />
              {loadingModels ? "Loading" : "Refresh"}
            </button>
          </div>
          {loadingModels && (
            <div className="text-xs text-[#E8EAF0]/40 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] mb-2">
              Fetching available models...
            </div>
          )}
          {modelsError && !loadingModels && models.length === 0 && (
            <div className="text-xs text-red-400/60 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10 mb-2">
              Could not fetch models. Enter model ID manually below.
            </div>
          )}
          {!loadingModels && models.length > 0 && (
            <div className="text-xs text-[#E8EAF0]/40 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] mb-2">
              {models.length} model{models.length !== 1 ? "s" : ""} available
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-[#E8EAF0]/40 block mb-0.5">Fast</label>
              <Input
                variant="select"
                value={fastModel}
                options={modelOptions}
                placeholder="Fast model ID"
                onChange={(val) => updateDraft((d) => {
                  const p = (d.config.ai as any)[name];
                  if (p) p.fast_model = val;
                })}
              />
            </div>
            <div>
              <label className="text-[10px] text-[#E8EAF0]/40 block mb-0.5">Balanced</label>
              <Input
                variant="select"
                value={balancedModel}
                options={modelOptions}
                placeholder="Balanced model ID"
                onChange={(val) => updateDraft((d) => {
                  const p = (d.config.ai as any)[name];
                  if (p) p.balanced_model = val;
                })}
              />
            </div>
            <div>
              <label className="text-[10px] text-[#E8EAF0]/40 block mb-0.5">Powerful</label>
              <Input
                variant="select"
                value={powerfulModel}
                options={modelOptions}
                placeholder="Powerful model ID"
                onChange={(val) => updateDraft((d) => {
                  const p = (d.config.ai as any)[name];
                  if (p) p.powerful_model = val;
                })}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end items-center gap-2 pt-1">
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer disabled:opacity-40 bg-white/[0.04] text-[#E8EAF0]/60 border border-white/[0.06] hover:bg-white/[0.08]"
          >
            <RefreshCw size={12} className={testing ? "animate-spin" : testResult === "success" ? "text-green-400/80" : "text-red-400/80"} />
            {testing ? "Testing..." : testResult === "success" ? (
              <span className="text-xs text-green-400/80">Connected</span>
            ) : (
              <span className="text-xs text-red-400/80">Connection failed</span>
            )}
          </button>

          <button
            onClick={handleSaveKey}
            disabled={!apiKey}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20"
          >
            Save
          </button>
        </div>
      </div>

      <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove API Key" description={`Are you sure you want to remove the ${providerInfo.displayName} API key?`}>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => setConfirmRemove(false)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer bg-white/[0.04] text-[#E8EAF0]/60 border border-white/[0.06] hover:bg-white/[0.08]"
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteKey}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
          >
            Remove
          </button>
        </div>
      </Modal>
    </>
  );
}


