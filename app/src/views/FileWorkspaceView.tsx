import { FolderOpen, FileText } from "lucide-react";
import { Tab } from "@aurora/types";

import { FileViewer } from "../components/editor/FileViewer";

interface FileWorkspaceViewProps {
  tab: Tab;
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

export function FileWorkspaceView({ tab, onOpenFile, onOpenFolder }: FileWorkspaceViewProps) {
  return tab.filePath ? (
    <div className="relative h-full">
      <FileViewer tabId={tab.id} filePath={tab.filePath} fileName={tab.name} />
    </div>
  ) : (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-sm mx-auto w-full text-on-surface select-text">
      <div className="mb-6 flex flex-col items-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <FolderOpen size={24} />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Aurora Workspace</h2>
        <p className="text-[11px] text-on-surface-variant/60 mt-1.5 leading-relaxed max-w-[240px]">
          No files are open. Select an option to start editing in this workspace.
        </p>
      </div>

      <div className="flex flex-col gap-2.5 w-full">
        <button onClick={onOpenFile} className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary active:scale-[0.98] transition-all font-semibold text-xs cursor-pointer shadow-md shadow-primary/10">
          <FileText size={14} className="text-on-primary" />
          <span>Open File</span>
        </button>

        <button onClick={onOpenFolder} className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-secondary text-on-secondary active:scale-[0.98] transition-all font-semibold text-xs cursor-pointer shadow-md shadow-secondary/10">
          <FolderOpen size={14} className="text-on-secondary" />
          <span>Open Folder</span>
        </button>
      </div>
    </div>
  );
}