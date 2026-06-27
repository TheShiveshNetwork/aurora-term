import { FolderOpen, FileText, GitBranch, MonitorSmartphone, Palette, ArrowUpFromLine, SquareTerminal } from "lucide-react";
import { Tab } from "@aurora/types";

import { FileViewer } from "../components/editor/FileViewer";
import { EmptyState } from "../components/ui/EmptyState";
import auroraIcon from "/static/aurora-icon.png";

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
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-5xl mx-auto w-full text-on-surface select-none">
      <div className="flex flex-col items-center">
        {/* <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <FolderOpen size={24} />
        </div> */}
        <img src={auroraIcon} alt="" className="w-32 h-32 rounded-[6px] shrink-0 object-contain" />
        <h2 className="text-xl font-bold tracking-tight">Aurora Workspace</h2>
        <p className="text-sm text-on-surface-variant/60 mt-1.5 leading-relaxed">
          Open a file or folder to get started.
        </p>
        <p className="text-sm text-on-surface-variant/60 mt-1.5 leading-relaxed">
          Your edits, commands, and AI actions will appear here.
        </p>
      </div>

      <hr className="w-full my-8 text-outline" />

      <div className="flex flex-col gap-2.5 w-full">
        <span className="text-sm text-left font-medium leading-relaxed">
          Get Started
        </span>
        <div className="flex gap-4">
          <ViewOptionButton label="Open File" icon={<FileText className="text-on-primary" />} onClick={onOpenFile} keymap="Ctrl + O" />
          <ViewOptionButton label="Open Folder" icon={<FolderOpen className="text-on-secondary" />} onClick={onOpenFolder} keymap="Ctrl + Shift + O" />
          <ViewOptionButton label="Clone Repository" icon={<GitBranch className="text-on-secondary" />} onClick={() => { /* TODO */ }} keymap="Ctrl + Shift + Alt + C" />
          {/* TODO: <ViewOptionButton label="Connect Remote" icon={<MonitorSmartphone className="text-on-secondary" />}} keymap="Ctrl + Shift + O" /> */}
        </div>
      </div>

      <hr className="w-full my-8 text-outline" />

      <div className="flex flex-col gap-2.5 text-left w-full">
        <span className="text-sm text-left font-medium leading-relaxed">
          Tips
        </span>

        <div className="flex flex-col gap-4 text-xs text-gray-400 leading-relaxed">
          <div className="flex gap-3 items-start">
            <span className="text-gray-500"><Palette size={16} /></span>
            <p>
              Use the command palette <span className="text-gray-300 font-mono bg-white/[0.03] px-1 py-0.5 rounded border border-white/5">Ctrl + P</span> to access all features.
            </p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-gray-500"><ArrowUpFromLine size={16} /></span>
            <p>Drag and drop files into the explorer to quickly open them.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-gray-500"><SquareTerminal size={16} /></span>
            <p>Start typing in the command bar below to run terminal commands or ask Aurora.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewOptionButton({
  label,
  icon,
  className = "",
  keymap,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  className?: string;
  keymap?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-start gap-4 p-4 w-full w-full rounded-md bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 active:scale-[0.98] transition-all duration-200 cursor-pointer text-left ${className}`}
    >
      {/* Icon Container - Overrides both size AND color passed to the child */}
      <span className="flex-shrink-0 text-blue-400 group-hover:text-blue-300 transition-colors [&>svg]:w-6 [&>svg]:h-6 [&>svg]:!text-current">
        {icon}
      </span>

      {/* Text & Keymap Container */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">
          {label}
        </span>

        {keymap && (
          <div className="flex items-center gap-1 text-[11px] font-mono text-gray-500 tracking-wide">
            {keymap.split(" + ").map((key, index, array) => (
              <span key={key} className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/5 text-gray-400 shadow-sm">
                  {key}
                </kbd>
                {index < array.length - 1 && <span className="text-gray-600 font-sans">+</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}