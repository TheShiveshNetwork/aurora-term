import React, { useState } from "react";
import { Plus, MessageSquare, MoreHorizontal } from "lucide-react";
import { MenuView, MenuViewItem } from "../ui/MenuView";
import { IconButton } from "../ui/IconButton";

interface AgentLeftPanelProps {
  leftWidth: number;
  onLeftDragHandleMouseDown: (e: React.MouseEvent) => void;
  handleNewSession: () => void;
  agentSessions: Array<{ id: string; title?: string }>;
  targetSessionId: string | null;
  setActiveAgentSessionId: (id: string | null) => void;
  deleteAgentSession: (id: string) => void;
  renameAgentSession: (id: string, title: string) => void;
}

export function AgentLeftPanel({
  leftWidth,
  onLeftDragHandleMouseDown,
  handleNewSession,
  agentSessions,
  targetSessionId,
  setActiveAgentSessionId,
  deleteAgentSession,
  renameAgentSession,
}: AgentLeftPanelProps) {
  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [tempSessionTitle, setTempSessionTitle] = useState("");

  const saveRename = (sessionId: string) => {
    if (tempSessionTitle.trim()) {
      renameAgentSession(sessionId, tempSessionTitle.trim());
    }
    setEditingSessionId(null);
  };

  return (
    <div
      className="shrink-0 flex flex-col h-full bg-[#0F131A] border-r border-white/[0.06] select-none relative"
      style={{ width: leftWidth }}
    >
      {/* New Session Button */}
      <div className="p-3">
        <button
          onClick={handleNewSession}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-white/[0.08] hover:bg-white/[0.05] text-xs font-semibold text-on-surface cursor-pointer transition-all"
        >
          <Plus size={14} />
          New Session
        </button>
      </div>

      {/* Scrollable list of previous sessions */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 space-y-1">
        <div className="px-2 py-1 text-xs font-bold tracking-wider text-white/30">
          Recent Chats
        </div>
        {agentSessions.length === 0 ? (
          <div className="text-xs mt-4 text-white/20 italic text-center">
            No previous sessions
          </div>
        ) : (
          agentSessions.map((s) => {
            const isActive = s.id === targetSessionId;
            const isEditing = s.id === editingSessionId;

            return (
              <div
                key={s.id}
                onClick={() => !isEditing && setActiveAgentSessionId(s.id)}
                className={`group flex items-center justify-between px-3 py-1 rounded-sm text-xs hover:bg-white/[0.04] text-white/70 hover:text-white transition-all cursor-pointer border ${isActive ? "bg-white/[0.06] text-white font-medium border-white/[0.04]" : "border-transparent"
                  }`}
              >
                {isEditing ? (
                  <input
                    type="text"
                    className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-primary font-medium w-full"
                    value={tempSessionTitle}
                    onChange={(e) => setTempSessionTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        saveRename(s.id);
                      } else if (e.key === "Escape") {
                        setEditingSessionId(null);
                      }
                    }}
                    onBlur={() => saveRename(s.id)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{s.title || "Untitled Session"}</span>
                    </div>

                    <div className="relative">
                      <IconButton
                        icon={<MoreHorizontal size={12} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuSessionId(activeMenuSessionId === s.id ? null : s.id);
                        }}
                        tooltip="Session Actions"
                        size="sm"
                        variant="ghost"
                      />

                      <MenuView
                        open={activeMenuSessionId === s.id}
                        onClose={() => setActiveMenuSessionId(null)}
                        className="absolute right-0 mt-1 w-36 z-[999]"
                        style={{ pointerEvents: "auto" }}
                      >
                        <MenuViewItem
                          onClick={() => {
                            setActiveMenuSessionId(null);
                            setActiveAgentSessionId(s.id);
                          }}
                        >
                          Open Session
                        </MenuViewItem>
                        <MenuViewItem
                          onClick={() => {
                            setActiveMenuSessionId(null);
                            setEditingSessionId(s.id);
                            setTempSessionTitle(s.title || "");
                          }}
                        >
                          Rename Session
                        </MenuViewItem>
                        <MenuViewItem
                          onClick={() => {
                            setActiveMenuSessionId(null);
                            deleteAgentSession(s.id);
                          }}
                          danger
                        >
                          Delete Session
                        </MenuViewItem>
                      </MenuView>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Resize handle on right edge */}
      <div
        onMouseDown={onLeftDragHandleMouseDown}
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-30 group select-none"
        title="Drag to resize"
      >
        <div
          className="w-px h-full mr-auto transition-colors"
          style={{ background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(79,140,255,0.35)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        />
      </div>
    </div>
  );
}
export default AgentLeftPanel;
