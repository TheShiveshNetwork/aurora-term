import type {
  AgentMessageRecord,
  AgentSessionPatch,
  AgentSessionRestored,
  AgentTitleSource,
} from "@aurora/types";
import { invoke } from "@tauri-apps/api/core";

import { agentSessions as ipc } from "./ipc";
import { deriveSessionPreview } from "./sessionTitle";
import type { ChatMessage, SessionAgentState } from "../stores/useAgentStore";

const META_DEBOUNCE_MS = 400;
const MESSAGE_DEBOUNCE_MS = 1200;

export interface AgentSessionTitleRequest {
  sessionId: string;
  projectId: string;
  goal: string;
  model?: string;
}

export interface AgentSessionTitleResponse {
  status: string;
  title?: string | null;
}

type Subscribe = (listener: (next: unknown, previous: unknown) => void) => () => void;

interface Fingerprints {
  meta: string;
  messages: string;
}

export const agentSessionTitle = (request: AgentSessionTitleRequest) =>
  invoke<AgentSessionTitleResponse>("agent_session_title", { request });

export const agentSessionAttachThread = (sessionId: string, projectId: string) =>
  invoke<void>("agent_session_attach_thread", { sessionId, projectId });

/**
 * Projects a live session down to what gets stored. `chatHistory` is stripped
 * because the transcript lives in its own table — keeping it out of the `state`
 * blob avoids writing it twice.
 */
function toPersistedState(state: SessionAgentState): string {
  const { chatHistory: _chatHistory, ...rest } = state;
  return JSON.stringify(rest);
}

function fromPersistedState(raw: string, chatHistory: ChatMessage[]): SessionAgentState | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { ...parsed, chatHistory } as SessionAgentState;
  } catch {
    return null;
  }
}

/**
 * A session earns a row once it has said something. An untouched draft chat is
 * not history, so it stays in memory only until the first message arrives.
 */
export function isPersistableSession(state: SessionAgentState): boolean {
  if (!state.isAgentViewSession) return false;
  return state.chatHistory.length > 0 || !!state.title || !!state.originalGoal;
}

function toMessageRecords(sessionId: string, chatHistory: ChatMessage[]): AgentMessageRecord[] {
  return chatHistory.map((msg, seq) => ({
    id: msg.id,
    sessionId,
    seq,
    role: msg.role,
    content: JSON.stringify(msg),
    createdAt: msg.timestamp,
  }));
}

function fromMessageRecords(records: AgentMessageRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const record of records) {
    try {
      messages.push(JSON.parse(record.content) as ChatMessage);
    } catch {
      // Retention may have replaced an old body with a stub; skip it rather than
      // render an empty turn.
    }
  }
  return messages;
}

export function buildSessionPatch(
  projectId: string,
  id: string,
  state: SessionAgentState,
): AgentSessionPatch {
  const patch: AgentSessionPatch = {
    id,
    projectId,
    agentType: state.agentType,
    agentMode: state.agentMode,
    status: state.status,
    state: toPersistedState(state),
  };
  if (state.model) patch.model = state.model;
  if (state.title) {
    patch.title = state.title;
    patch.titleSource = (state.titleSource ?? "placeholder") as AgentTitleSource;
  }
  if (state.originalGoal) {
    patch.goal = state.originalGoal;
    const preview = deriveSessionPreview(state.originalGoal);
    if (preview) patch.firstPrompt = preview;
  }
  return patch;
}

/**
 * Mirrors the in-memory agent store into SQLite.
 *
 * Writes are debounced per session and split in two: metadata (cheap, drives
 * the session list) flushes fast, the transcript on a longer debounce so a
 * streaming response does not produce a write per chunk. Only Agent-view
 * sessions are mirrored — terminal-agent tabs stay ephemeral by design.
 */
export class AgentSessionRepository {
  private projectId: string | null = null;
  private sessions: Record<string, SessionAgentState> = {};
  private readonly written = new Map<string, Fingerprints>();
  private readonly metaTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly messageTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: (() => void) | null = null;
  private hydrated = false;

  getProjectId(): string | null {
    return this.projectId;
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  /**
   * Points the repository at a project. Switching projects clears the write
   * fingerprints so the next change to a re-used session id is not swallowed.
   */
  async useProject(path: string, label?: string): Promise<AgentSessionRestored[]> {
    if (!path) {
      this.projectId = null;
      this.hydrated = false;
      this.written.clear();
      return [];
    }
    const result = await ipc.hydrate(path, label);
    this.projectId = result.project.id;
    this.hydrated = true;
    this.written.clear();
    return result.sessions;
  }

  start(subscribe: Subscribe, getSessions: () => Record<string, SessionAgentState>): void {
    if (this.unsubscribe) return;
    this.unsubscribe = subscribe((next, previous) => {
      this.sync(
        (next as { sessions: Record<string, SessionAgentState> }).sessions,
        (previous as { sessions: Record<string, SessionAgentState> }).sessions,
      );
    });
    this.sync(getSessions(), {});
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * A draft chat that has never been written is skipped, so opening the app
   * does not litter the list with empty rows. Once a session does have a row it
   * keeps mirroring — otherwise clearing a chat would leave the old transcript
   * stranded on disk.
   */
  private shouldMirror(id: string, state: SessionAgentState): boolean {
    if (!state.isAgentViewSession) return false;
    return this.written.has(id) || isPersistableSession(state);
  }

  private sync(
    sessions: Record<string, SessionAgentState>,
    previous: Record<string, SessionAgentState>,
  ): void {
    this.sessions = sessions;
    if (!this.projectId) return;

    const ids = new Set([...Object.keys(sessions), ...Object.keys(previous)]);
    for (const id of ids) {
      const state = sessions[id];
      if (!state) {
        this.written.delete(id);
        this.clearTimers(id);
        continue;
      }
      if (!this.shouldMirror(id, state)) continue;

      const seen = this.written.get(id);
      const metaKey = JSON.stringify(buildSessionPatch(this.projectId, id, state));
      const messageKey = JSON.stringify(state.chatHistory.map((m) => m.id));

      if (seen?.meta !== metaKey) this.scheduleMeta(id, state, metaKey);
      if (seen?.messages !== messageKey) this.scheduleMessages(id, state, messageKey);
    }
  }

  private scheduleMeta(
    id: string,
    state: SessionAgentState,
    fingerprint: string,
  ): void {
    const existing = this.metaTimers.get(id);
    if (existing) clearTimeout(existing);
    this.metaTimers.set(
      id,
      setTimeout(() => {
        this.metaTimers.delete(id);
        this.writeMeta(id, state, fingerprint);
      }, META_DEBOUNCE_MS),
    );
  }

  private scheduleMessages(
    id: string,
    state: SessionAgentState,
    fingerprint: string,
  ): void {
    const existing = this.messageTimers.get(id);
    if (existing) clearTimeout(existing);
    this.messageTimers.set(
      id,
      setTimeout(() => {
        this.messageTimers.delete(id);
        this.writeMessages(id, state, fingerprint);
      }, MESSAGE_DEBOUNCE_MS),
    );
  }

  private writeMeta(id: string, state: SessionAgentState, fingerprint: string): void {
    const projectId = this.projectId;
    if (!projectId) return;
    this.remember(id, "meta", fingerprint);
    ipc.upsert(buildSessionPatch(projectId, id, state)).catch(() => {
      this.forget(id, "meta");
    });
  }

  private writeMessages(id: string, state: SessionAgentState, fingerprint: string): void {
    const projectId = this.projectId;
    if (!projectId) return;
    this.remember(id, "messages", fingerprint);
    // The parent row must exist before messages can reference it.
    ipc
      .upsert(buildSessionPatch(projectId, id, state))
      .then(() => ipc.replaceMessages(id, toMessageRecords(id, state.chatHistory)))
      .catch(() => this.forget(id, "messages"));
  }

  private remember(id: string, slot: keyof Fingerprints, value: string): void {
    const seen = this.written.get(id) ?? { meta: "", messages: "" };
    seen[slot] = value;
    this.written.set(id, seen);
  }

  private forget(id: string, slot: keyof Fingerprints): void {
    const seen = this.written.get(id);
    if (seen) seen[slot] = "";
  }

  private clearTimers(id: string): void {
    const meta = this.metaTimers.get(id);
    if (meta) clearTimeout(meta);
    const messages = this.messageTimers.get(id);
    if (messages) clearTimeout(messages);
    this.metaTimers.delete(id);
    this.messageTimers.delete(id);
  }

  /** Cancels pending debounces and writes everything immediately. */
  flush(): void {
    for (const id of Array.from(this.metaTimers.keys())) clearTimeout(this.metaTimers.get(id)!);
    for (const id of Array.from(this.messageTimers.keys())) {
      clearTimeout(this.messageTimers.get(id)!);
    }
    this.metaTimers.clear();
    this.messageTimers.clear();

    for (const [id, state] of Object.entries(this.sessions)) {
      if (!this.shouldMirror(id, state)) continue;
      this.writeMeta(
        id,
        state,
        JSON.stringify(buildSessionPatch(this.projectId ?? "", id, state)),
      );
      this.writeMessages(id, state, JSON.stringify(state.chatHistory.map((m) => m.id)));
    }
  }

  async rename(id: string, title: string): Promise<void> {
    this.forget(id, "meta");
    await ipc.rename(id, title);
  }

  async remove(id: string): Promise<void> {
    this.clearTimers(id);
    this.written.delete(id);
    await ipc.remove(id);
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    this.forget(id, "meta");
    await ipc.setPinned(id, pinned);
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    this.forget(id, "meta");
    await ipc.setArchived(id, archived);
  }

  /** Runs the retention sweep, sparing the sessions the user may still open. */
  async prune(protect: string[]): Promise<void> {
    const ids = protect.filter(Boolean);
    if (ids.length > 0) await ipc.prune({ protect: ids });
  }

  /** Restores a stored session into a `SessionAgentState`. */
  rehydrate(item: AgentSessionRestored): SessionAgentState | null {
    const messages = fromMessageRecords(item.messages);
    const restored = fromPersistedState(item.state, messages);
    if (!restored) return null;
    return {
      ...restored,
      title: item.title ?? restored.title,
      titleSource: item.titleSource,
      // A session restored from disk has already had its naming chances; asking
      // again on every launch burns an LLM call per session and churns state.
      titleAttempted: true,
      isAgentViewSession: true,
      chatHistory: messages,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  /**
   * Marks a session as already matching disk. Called after hydration so the
   * restore itself is not immediately written back.
   */
  markSynced(id: string, state: SessionAgentState): void {
    const projectId = this.projectId;
    if (!projectId) return;
    this.clearTimers(id);
    this.remember(id, "meta", JSON.stringify(buildSessionPatch(projectId, id, state)));
    this.remember(id, "messages", JSON.stringify(state.chatHistory.map((m) => m.id)));
  }
}

export const agentSessionRepository = new AgentSessionRepository();

/**
 * Requests a model-written title. Never throws: the caller keeps whatever
 * heuristic title it already has, and a rename that lands while the request is
 * in flight is preserved by the title-source precedence enforced in Rust.
 */
export async function requestModelTitle(
  sessionId: string,
  projectId: string,
  goal: string,
  model?: string,
): Promise<string | null> {
  if (!projectId || !goal.trim()) return null;
  try {
    const response = await agentSessionTitle({ sessionId, projectId, goal, model });
    const title = response?.title?.trim();
    return title ? title.slice(0, 80) : null;
  } catch {
    return null;
  }
}
