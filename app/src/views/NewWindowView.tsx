import { FolderOpen } from "lucide-react";
import auroraIcon from "/static/aurora-icon.png";

interface NewWindowViewProps {
  onOpenFolder: () => void;
}

export function NewWindowView({ onOpenFolder }: NewWindowViewProps) {
  return (
    <div className="overflow-y-auto flex-1 flex flex-col items-start justify-start h-full min-h-0">
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-3xl w-full mx-auto text-on-surface select-none">
        <div className="flex flex-col items-center">
          <img src={auroraIcon} alt="" className="w-32 h-32 rounded-[6px] shrink-0 object-cover" />
          <h2 className="text-xl font-bold tracking-tight mt-5">Aurora</h2>
          <p className="text-sm text-on-surface-variant/60 mt-1.5 leading-relaxed">
            Open a folder to start your agentic session.
          </p>
        </div>

        <hr className="w-full my-8 border-outline" />

        <div className="flex flex-col gap-2.5 w-full">
          <span className="text-sm text-left font-medium leading-relaxed">
            Get Started
          </span>
          <ViewOptionButton label="Open Folder" icon={<FolderOpen />} onClick={onOpenFolder} keymap="Ctrl + O" />
        </div>

        <hr className="w-full my-8 border-outline" />

        <div className="flex flex-col gap-2.5 text-left w-full">
          <span className="text-sm text-left font-medium leading-relaxed">
            Tips
          </span>
          <div className="flex flex-col gap-4 text-xs text-gray-400 leading-relaxed">
            <TipItem icon="zap" text='Press Ctrl + O or click "Open Folder" to select your project directory.' />
            <TipItem icon="monitor" text='Switch to Agent Mode using the header toggle or press Ctrl + I to start an AI-powered terminal session.' />
            <TipItem icon="file" text="Once a folder is open, you can create, edit, and run files through the integrated terminal and AI assistant." />
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewOptionButton({
  label,
  icon,
  keymap,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  keymap?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-4 p-4 w-full rounded-md bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 active:scale-[0.98] transition-all duration-200 cursor-pointer text-left"
    >
      <span className="flex-shrink-0 text-blue-400 group-hover:text-blue-300 transition-colors [&>svg]:w-6 [&>svg]:h-6 [&>svg]:!text-current">
        {icon}
      </span>
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

function TipItem({ icon, text }: { icon: string; text: string }) {
  const svgIcon = () => {
    switch (icon) {
      case "zap":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        );
      case "monitor":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        );
      case "file":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex gap-3 items-start">
      <span className="text-gray-500 shrink-0 mt-0.5">{svgIcon()}</span>
      <p className="[&_.kbd]:px-1.5 [&_.kbd]:py-0.5 [&_.kbd]:rounded [&_.kbd]:bg-white/[0.03] [&_.kbd]:border [&_.kbd]:border-white/5 [&_.kbd]:text-gray-300 [&_.kbd]:font-mono [&_.kbd]:text-[11px] [&_.kbd]:shadow-sm">
        {text.split(/(Ctrl \+ [A-Z]|Ctrl \+ I|"Open Folder"|Agent Mode)/g).map((part, i) => {
          if (part === "Ctrl + O" || part === "Ctrl + I") {
            const keys = part.split(" + ");
            return (
              <span key={i} className="inline-flex items-center gap-0.5 mx-0.5 align-baseline">
                {keys.map((k, j, arr) => (
                  <span key={j} className="inline-flex items-center gap-0.5">
                    <kbd className="px-1 py-0.5 rounded bg-white/[0.03] border border-white/5 text-gray-300 font-mono text-[11px] shadow-sm">{k}</kbd>
                    {j < arr.length - 1 && <span className="text-gray-600 font-sans text-[10px]">+</span>}
                  </span>
                ))}
              </span>
            );
          }
          if (part === '"Open Folder"' || part === 'Agent Mode') {
            return <code key={i} className="px-1 py-0.5 rounded bg-white/[0.03] border border-white/5 text-gray-300 font-mono text-[11px] shadow-sm">{part}</code>;
          }
          return part;
        })}
      </p>
    </div>
  );
}

export default NewWindowView;

