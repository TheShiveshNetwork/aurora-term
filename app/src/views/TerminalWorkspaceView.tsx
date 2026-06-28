import { Terminal } from "lucide-react";
import { Tab } from "@aurora/types";

import { TerminalPane } from "../components/terminal/TerminalPane";
import { EmptyState } from "../components/ui/EmptyState";

interface TerminalWorkspaceViewProps {
  tab: Tab;
  isVisible: boolean;
  isCommandRunning?: boolean;
  isAlternateActive: boolean;
  hasInteracted: boolean;
}

export function TerminalWorkspaceView({ tab, isVisible, isCommandRunning, isAlternateActive, hasInteracted }: TerminalWorkspaceViewProps) {
  const showEmptyState = !hasInteracted;

  return (
    <div className="relative h-full flex flex-row bg-surface-container-low overflow-hidden">
      <div className="flex-1 h-full min-w-0">
        <TerminalPane isVisible={isVisible} sessionId={tab.id} isRunning={isCommandRunning} />
      </div>

      {showEmptyState && !isAlternateActive && (
        <div className="absolute inset-0 z-10 pb-12 h-full flex items-center justify-center">
          <EmptyState icon={<Terminal size={48} />} title="Ready for commands or AI prompts" />
        </div>
      )}
    </div>
  );
}