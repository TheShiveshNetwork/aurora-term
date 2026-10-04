export type AgentTitleSource = "none" | "placeholder" | "model" | "manual";

export type AgentSessionStatus =
  | "idle"
  | "planning"
  | "executing"
  | "paused"
  | "completed"
  | "error";

export interface AgentProject {
  id: string;
  path: string;
  label: string | null;
  lastOpened: number;
}

export interface AgentSessionRecord {
  id: string;
  projectId: string;
  title: string | null;
  titleSource: AgentTitleSource;
  summary: string | null;
  goal: string | null;
  firstPrompt: string | null;
  agentType: string;
  agentMode: string;
  model: string | null;
  status: AgentSessionStatus | string;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
  /** Serialized SessionAgentState minus chatHistory, which lives in agent_messages. */
  state: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentSessionListItem extends AgentSessionRecord {
  preview: string | null;
}

export interface AgentMessageRecord {
  id: string;
  sessionId: string;
  seq: number;
  role: string;
  /** JSON-encoded ChatMessage. */
  content: string;
  createdAt: number;
}

export interface AgentSessionRestored extends AgentSessionListItem {
  messages: AgentMessageRecord[];
}

export interface AgentSessionHydration {
  project: AgentProject;
  sessions: AgentSessionRestored[];
}

export interface AgentSessionPatch {
  id: string;
  projectId: string;
  title?: string;
  titleSource?: AgentTitleSource;
  summary?: string;
  goal?: string;
  firstPrompt?: string;
  agentType?: string;
  agentMode?: string;
  model?: string;
  status?: string;
  state?: string;
}

export interface AgentStorageStats {
  sessions: number;
  projects: number;
  bytes: number;
}

export interface AgentPruneReport {
  droppedSessions: string[];
  trimmedSessions: string[];
  bytesBefore: number;
  bytesAfter: number;
}

export interface AgentPruneOptions {
  maxTotalBytes?: number;
  maxSessionBytes?: number;
  minAgeMs?: number;
  keepMessageBodies?: number;
  protect?: string[];
}
