import { Terminal } from "lucide-react";
import { Tab } from "@aurora/types";

import { TerminalPane } from "../components/terminal/TerminalPane";

interface TerminalWorkspaceViewProps {
  tab: Tab;
  isVisible: boolean;
  isCommandRunning?: boolean;
  isAlternateActive: boolean;
  hasInteracted: boolean;
  activeBlocksCount: number;
}

export function TerminalWorkspaceView({ tab, isVisible, isCommandRunning, isAlternateActive, hasInteracted, activeBlocksCount }: TerminalWorkspaceViewProps) {
  const showEmptyState = !hasInteracted && activeBlocksCount <= 1;

  return (
    <div className="relative h-full flex flex-row bg-surface-container-low overflow-hidden">
      <div className="flex-1 h-full min-w-0">
        <TerminalPane isVisible={isVisible} sessionId={tab.id} isRunning={isCommandRunning} />
      </div>

      {showEmptyState && !isAlternateActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 pointer-events-none select-none z-10 pb-12">
          <Terminal size={48} className="mb-4" />
          <span className="font-label-caps uppercase text-[10px] tracking-widest text-on-surface-variant">
            Ready for commands or AI prompts
          </span>
        </div>
      )}
    </div>
  );
}