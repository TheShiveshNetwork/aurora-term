import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { InMemoryStore } from '@mastra/core/storage';

const DB_DIR = join(homedir(), '.aurora-agent');
const WORKFLOWS_FILE = join(DB_DIR, 'agentic-loop-workflows.json');
const THREADS_DIR = join(DB_DIR, 'threads');

/** Bounds a single thread file. Older messages are the first thing to go: the
 *  frontend keeps the full transcript in SQLite, and the thread file only has
 *  to carry enough context to resume the conversation. */
const MAX_MESSAGES_PER_THREAD = 400;
const THREAD_TTL_MS = 45 * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function loadWorkflowsFile(): Map<string, any> {
  const map = new Map<string, any>();
  try {
    if (!existsSync(WORKFLOWS_FILE)) return map;
    const entries: [string, any][] = JSON.parse(readFileSync(WORKFLOWS_FILE, 'utf-8'));
    for (const [k, v] of entries) map.set(k, v);
  } catch {
    /* ignore corrupt file */
  }
  return map;
}

function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, 'utf-8');
  renameSync(tmp, path);
}

function threadFile(threadId: string): string {
  return join(THREADS_DIR, `${encodeURIComponent(threadId)}.json`);
}

function loadThreadFile(threadId: string): { thread: any; messages: any[] } | null {
  try {
    const path = threadFile(threadId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function listThreadIds(): string[] {
  try {
    if (!existsSync(THREADS_DIR)) return [];
    return readdirSync(THREADS_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try {
          return decodeURIComponent(name.slice(0, -'.json'.length));
        } catch {
          return null;
        }
      })
      .filter((id): id is string => !!id);
  } catch {
    return [];
  }
}

function restoreThread(threadId: string, db: any): void {
  const saved = loadThreadFile(threadId);
  if (!saved?.thread) return;
  db.threads.set(saved.thread.id ?? threadId, saved.thread);
  for (const message of saved.messages ?? []) {
    db.messages.set(message.id, message);
  }
}

function purgeStaleThreadFiles(): void {
  try {
    if (!existsSync(THREADS_DIR)) return;
    const cutoff = Date.now() - THREAD_TTL_MS;
    for (const name of readdirSync(THREADS_DIR)) {
      if (!name.endsWith('.json')) continue;
      const path = join(THREADS_DIR, name);
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
    }
  } catch {
    /* ignore */
  }
}

function wrapWorkflowsStore(real: any) {
  const save = () => {
    try {
      if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
      writeAtomic(WORKFLOWS_FILE, JSON.stringify(Array.from(real.db.workflows.entries())));
    } catch {
      /* ignore write errors */
    }
  };
  return {
    getWorkflowKey: (...a: any[]) => real.getWorkflowKey(...a),
    persistWorkflowSnapshot: async (...a: any[]) => {
      const r = await real.persistWorkflowSnapshot(...a);
      save();
      return r;
    },
    loadWorkflowSnapshot: (...a: any[]) => real.loadWorkflowSnapshot(...a),
    listWorkflowRuns: (...a: any[]) => real.listWorkflowRuns(...a),
    getWorkflowRunById: (...a: any[]) => real.getWorkflowRunById(...a),
    deleteWorkflowRunById: async (...a: any[]) => {
      const r = await real.deleteWorkflowRunById(...a);
      save();
      return r;
    },
    updateWorkflowResults: async (...a: any[]) => {
      const r = await real.updateWorkflowResults(...a);
      save();
      return r;
    },
    updateWorkflowState: async (...a: any[]) => {
      const r = await real.updateWorkflowState(...a);
      save();
      return r;
    },
    dangerouslyClearAll: async (...a: any[]) => {
      const r = await real.dangerouslyClearAll(...a);
      save();
      return r;
    },
    supportsConcurrentUpdates: () => real.supportsConcurrentUpdates?.(),
  };
}

/**
 * Mirrors the `memory` domain to one JSON file per thread.
 *
 * `InMemoryStore` keeps threads and messages in process `Map`s, so a sidecar
 * restart silently drops every conversation's LLM context. These files are a
 * cache of that context, not the source of truth — the session list and the full
 * transcript live in the app's SQLite. Losing a file costs recall continuity
 * for that one session and nothing else, which is why a corrupt or missing file
 * is skipped rather than treated as an error.
 *
 * A `Proxy` is used instead of an object literal so every unlisted method
 * (recall, listThreads, getThreadById, …) still reaches the real store — a
 * spread would drop the prototype methods and break `auraMemory`.
 */
function wrapMemoryStore(real: any) {
  let lastPurge = 0;

  const saveThread = (threadId: string) => {
    try {
      if (!existsSync(THREADS_DIR)) mkdirSync(THREADS_DIR, { recursive: true });
      const thread = real.db.threads.get(threadId);
      if (!thread) return;

      const messages = Array.from(real.db.messages.values()).filter(
        (m: any) => m.thread_id === threadId,
      );
      const trimmed =
        messages.length > MAX_MESSAGES_PER_THREAD
          ? messages.slice(messages.length - MAX_MESSAGES_PER_THREAD)
          : messages;

      writeAtomic(threadFile(threadId), JSON.stringify({ thread, messages: trimmed }));

      if (Date.now() - lastPurge > PURGE_INTERVAL_MS) {
        lastPurge = Date.now();
        purgeStaleThreadFiles();
      }
    } catch {
      /* best-effort mirror */
    }
  };

  const saveAll = () => {
    for (const threadId of real.db.threads.keys()) saveThread(threadId);
  };

  const after = (fn: (...args: any[]) => any) => async (...args: any[]) => {
    const result = await fn.apply(real, args);
    saveAll();
    return result;
  };

  const interceptors: Record<string, (...args: any[]) => any> = {
    saveThread: async ({ thread }: any) => {
      const result = await real.saveThread({ thread });
      saveThread(thread.id);
      return result;
    },
    updateThread: async (args: any) => {
      const result = await real.updateThread(args);
      saveThread(args.id);
      return result;
    },
    deleteThread: async ({ threadId }: any) => {
      const result = await real.deleteThread({ threadId });
      try {
        const path = threadFile(threadId);
        if (existsSync(path)) unlinkSync(path);
      } catch {
        /* ignore */
      }
      return result;
    },
    saveMessages: async (args: any) => {
      const result = await real.saveMessages(args);
      for (const message of args?.messages ?? []) {
        if (message.threadId) saveThread(message.threadId);
      }
      return result;
    },
    updateMessages: after(real.updateMessages),
    deleteMessages: after(real.deleteMessages),
    dangerouslyClearAll: after(real.dangerouslyClearAll),
  };

  return new Proxy(real, {
    get(target, prop, receiver) {
      const interceptor = interceptors[prop as string];
      if (interceptor) return interceptor;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * `InMemoryStore` extended with two on-disk mirrors:
 *
 *  - `workflows`, so an agentic-loop snapshot survives the suspend→approve
 *    window across a sidecar restart (#approval-flow);
 *  - `memory`, so threads and messages survive a restart and the agent can
 *    resume a conversation instead of starting cold.
 *
 * Every other domain keeps the plain in-memory behaviour.
 */
export class DurableInMemoryStore extends InMemoryStore {
  private wrappedWorkflows?: any;
  private wrappedMemory?: any;

  async getStore(key: any) {
    if (key === 'workflows') {
      if (!this.wrappedWorkflows) {
        const real: any = await super.getStore('workflows');
        const saved = loadWorkflowsFile();
        for (const [k, v] of saved) {
          try {
            real?.db?.workflows?.set(k, v);
          } catch {
            /* skip unloadable entry */
          }
        }
        this.wrappedWorkflows = wrapWorkflowsStore(real);
      }
      return this.wrappedWorkflows;
    }

    if (key === 'memory') {
      if (!this.wrappedMemory) {
        const real: any = await super.getStore('memory');
        for (const threadId of listThreadIds()) restoreThread(threadId, real.db);
        this.wrappedMemory = wrapMemoryStore(real);
      }
      return this.wrappedMemory;
    }

    return super.getStore(key);
  }
}
