import { Tab } from "@aurora/types";
import { useSessionStore } from "../stores/useSessionStore";
import { MergeEditor } from "../components/editor/MergeEditor";

interface MergeWorkspaceViewProps {
  tab: Tab;
}

export function MergeWorkspaceView({ tab }: MergeWorkspaceViewProps) {
  const killSession = useSessionStore((s) => s.killSession);

  if (!tab.filePath) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-on-surface-variant/40 bg-background">
        No merge file path provided.
      </div>
    );
  }

  return (
    <MergeEditor
      filePath={tab.filePath}
      cwd={tab.cwd || ""}
      onClose={() => killSession(tab.id)}
    />
  );
}
