import { Tab } from "@aurora/types";

interface SaveChangesModalProps {
  tab: Tab | null;
  onDiscard: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function SaveChangesModal({ tab, onDiscard, onCancel, onSave }: SaveChangesModalProps) {
  if (!tab) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-surface-container-high border border-outline-variant/20 rounded-xl shadow-2xl w-[420px] overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold text-on-surface mb-2">Save changes?</h3>
          <p className="text-xs text-on-surface-variant/80 leading-relaxed">
            Do you want to save the changes you made to <span className="text-primary font-medium">{tab.name}</span>?
          </p>
          <p className="text-[10px] text-on-surface-variant/50 mt-1">Your changes will be lost if you don't save them.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-2">
          <button className="px-3 py-1.5 text-[11px] rounded-lg border border-outline-variant/20 text-on-surface-variant hover:bg-surface-variant/20 transition-colors cursor-pointer" onClick={onDiscard}>
            Don't Save
          </button>
          <button className="px-3 py-1.5 text-[11px] rounded-lg text-on-surface-variant hover:bg-surface-variant/20 transition-colors cursor-pointer" onClick={onCancel}>
            Cancel
          </button>
          <button className="px-3 py-1.5 text-[11px] rounded-lg bg-primary text-on-primary hover:bg-primary/90 transition-colors cursor-pointer font-semibold" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}