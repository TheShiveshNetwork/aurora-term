export interface PtyDataEvent {
  session_id: string;
  data: string;
}

export interface PtyExitEvent {
  session_id: string;
  exit_code: number;
}

export interface AIStreamChunkEvent {
  request_id: string;
  chunk: string;
  done: boolean;
}

export interface ProcessSpawnedEvent {
  pid: number;
  command: string;
  session_id: string;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  status: string;
}