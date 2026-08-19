import React, { useState, useRef, useEffect } from "react";
import { Plus, ChevronDown, Mic, Paperclip, ArrowUp, X, Ellipsis } from "lucide-react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "../prompt-kit/prompt-input";
import { useAIStore } from "../../stores/useAIStore";

export interface AttachedFile {
  name: string;
  path: string;
  content: string;
}

interface AgentPromptInputProps {
  value: string;
  onValueChange: (val: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  attachedFiles: AttachedFile[];
  onRemoveFile: (idx: number) => void;
  isListening: boolean;
  toggleListening: () => void;
  onAttachClick?: () => void;
  className?: string;
  showModeSelector?: boolean;
  agentMode?: "plan" | "build";
  setAgentMode?: (mode: "plan" | "build") => void;
  taRef?: React.RefObject<HTMLTextAreaElement | null>;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyUp?: () => void;
  onClick?: () => void;
  onSelect?: () => void;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  showStatusDrawer?: boolean;
  onToggleStatusDrawer?: () => void;
}

export function AgentPromptInput({
  value,
  onValueChange,
  onSubmit,
  isLoading,
  attachedFiles,
  onRemoveFile,
  isListening,
  toggleListening,
  onAttachClick,
  className = "",
  showModeSelector = false,
  agentMode,
  setAgentMode,
  taRef,
  onFocus,
  onBlur,
  onKeyUp,
  onClick,
  onSelect,
  selectedModel = "",
  onModelChange,
  showStatusDrawer = false,
  onToggleStatusDrawer,
}: AgentPromptInputProps) {
  const activeProvider = useAIStore((s) => s.activeProvider);
  const providers = useAIStore((s) => s.providers);
  const currentProviderConfig = providers[activeProvider];

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const availableModels = currentProviderConfig
    ? Array.from(
      new Set(
        [
          currentProviderConfig.selectedModel,
          currentProviderConfig.fastModel,
          currentProviderConfig.balancedModel,
          currentProviderConfig.powerfulModel,
        ].filter((m): m is string => Boolean(m))
      )
    )
    : [];

  useEffect(() => {
    if (availableModels.length > 0 && (!selectedModel || !availableModels.includes(selectedModel))) {
      onModelChange?.(availableModels[0]);
    }
  }, [availableModels, selectedModel, onModelChange]);

  return (
    <div className={`w-full overflow-visible bg-on-surface-variant/10 border border-on-surface/10 rounded-md relative overflow-hidden p-0 cursor-text shadow-none ${className}`}>
      {/* Attached Files List */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-2 bg-white/[0.01] border-b border-white/[0.04] items-center">
          {attachedFiles.map((file, idx) => (
            <div key={idx} className="flex items-center gap-1.5 bg-white/[0.05] border border-white/[0.05] rounded-full pl-2.5 pr-1.5 py-1 text-xs text-white/80">
              <Paperclip size={11} className="text-primary/70" />
              <span className="max-w-[150px] truncate">{file.name}</span>
              <button
                onClick={() => onRemoveFile(idx)}
                className="p-0.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mode Selector & Input text */}
      <PromptInput
        isLoading={isLoading}
        value={value}
        onValueChange={onValueChange}
        onSubmit={onSubmit}
        disabled={isLoading}
        textareaRef={taRef}
        className="bg-transparent border-none p-2 shadow-none"
      >
        <PromptInputTextarea
          placeholder="Ask the developer agent to build, modify, or debug..."
          className="block w-full min-h-[44px] max-h-[200px] p-2.5 bg-transparent border-none outline-none resize-none text-[14px] leading-[1.6] text-white placeholder:text-white/20 overflow-y-auto scrollbar-thin focus-visible:ring-0 focus-visible:ring-offset-0"
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyUp={onKeyUp}
          onClick={onClick}
          onSelect={onSelect}
        />

        <PromptInputActions className="justify-between mt-3">
          <div className="flex items-center gap-1.5">
            <PromptInputAction tooltip="Attach file">
              <button
                onClick={onAttachClick}
                disabled={isLoading}
                className="flex items-center justify-center w-[34px] h-[34px] hover:bg-on-surface-variant/10 border border-transparent hover:border-on-surface-variant/20 rounded-lg text-[rgba(255,255,255,0.55)] cursor-pointer transition-all duration-150 hover:bg-[rgba(255,255,255,0.10)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus size={18} />
              </button>
            </PromptInputAction>

            {availableModels.length > 0 ? (
              <div
                ref={dropdownRef}
                className="relative inline-block text-left"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setIsOpen(!isOpen)}
                  className="inline-flex items-center gap-1.5 hover:bg-on-surface-variant/10 border border-transparent hover:border-on-surface-variant/20 rounded-lg px-2.5 py-1.5 text-[13px] text-[rgba(255,255,255,0.58)] cursor-pointer font-sans whitespace-nowrap transition-all duration-150"
                >
                  {selectedModel || availableModels[0]} <ChevronDown size={12} />
                </button>

                {isOpen && (
                  <div className="absolute bottom-full left-0 mb-1 w-48 bg-[#2c2c2c] border border-outline-variant/10 rounded-sm shadow-2xl p-1.5 z-50 flex flex-col gap-0.5">
                    {availableModels.map((model) => (
                      <button
                        key={model}
                        onClick={() => {
                          onModelChange?.(model);
                          setIsOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-2 text-[12.5px] rounded-sm cursor-pointer transition-colors ${selectedModel === model
                          ? "bg-on-surface-variant/15 text-white font-medium border border-on-surface-variant/10"
                          : "text-white/60 hover:text-white/95 border border-transparent hover:border-on-surface-variant/10 hover:bg-on-surface-variant/10"
                          }`}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button className="inline-flex items-center gap-1.5 hover:bg-on-surface-variant/10 border border-transparent hover:border-on-surface-variant/20 rounded-lg px-2.5 py-1.5 text-[13px] text-[rgba(255,255,255,0.58)] cursor-pointer font-sans whitespace-nowrap transition-all duration-150">
                No model <ChevronDown size={12} />
              </button>
            )}
            {onToggleStatusDrawer && (
              <PromptInputAction tooltip={showStatusDrawer ? "Hide Status Drawer" : "Show Status Drawer"}>
                <button
                  onClick={onToggleStatusDrawer}
                  className={`flex items-center justify-center w-[34px] h-[34px] rounded-lg transition-all duration-150 border border-transparent hover:border-on-surface-variant/20 cursor-pointer hover:bg-on-surface-variant/10`}
                >
                  <Ellipsis size={16} />
                </button>
              </PromptInputAction>
            )}

            {/* {showModeSelector && setAgentMode && agentMode && (
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => setAgentMode("plan")}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${agentMode === "plan"
                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                    : "text-white/30 border border-transparent"
                    }`}
                >
                  Plan Mode
                </button>
                <button
                  onClick={() => setAgentMode("build")}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${agentMode === "build"
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "text-white/30 border border-transparent"
                    }`}
                >
                  Build Mode
                </button>
              </div>
            )} */}
          </div>

          <div className="flex items-center gap-2">
            <PromptInputAction tooltip={isListening ? "Listening... Click to stop" : "Voice Input"}>
              <button
                onClick={toggleListening}
                className={`flex items-center justify-center w-8 h-8 border-none rounded-md cursor-pointer transition-colors duration-150 ${isListening
                  ? "bg-red-500/15 text-red-400 border border-red-500/20"
                  : "bg-transparent text-[rgba(255,255,255,0.32)] hover:text-[rgba(255,255,255,0.65)]"
                  }`}
              >
                <Mic size={14} className={isListening ? "animate-pulse" : ""} />
              </button>
            </PromptInputAction>

            <PromptInputAction tooltip="Send to Agent">
              <button
                onClick={onSubmit}
                disabled={!value.trim() || isLoading}
                className="flex items-center justify-center w-9 h-9 bg-[#4553d4] border-none rounded-lg cursor-pointer shrink-0 transition-all duration-150 hover:bg-[#5f6df0] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowUp size={18} />
              </button>
            </PromptInputAction>
          </div>
        </PromptInputActions>
      </PromptInput>
    </div>
  );
}
