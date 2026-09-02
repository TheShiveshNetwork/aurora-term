import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { InMemoryStore } from '@mastra/core/storage';

/**
 * The agentic-loop workflow snapshot that `resumeStream()` depends on must
 * survive between the suspend (when the agent needs tool approval) and the
 * approve/decline call. The default `InMemoryStore` keeps it only in process
 * memory, so if the sidecar process restarts (or the snapshot is otherwise
 * lost) resume fails with "could not find a suspended run".
 *
 * `DurableInMemoryStore` wraps the real `InMemoryStore` workflows domain and
 * mirrors every mutation to a JSON file, so the snapshot is restored on the
 * next process start. All other domains (memory, etc.) keep using the normal
 * in-memory implementation.
 */
const DB_DIR = join(homedir(), '.aurora-agent');
const WORKFLOWS_FILE = join(DB_DIR, 'agentic-loop-workflows.json');

function loadWorkflowsFile(): Map<string, any> {
  const map = new Map<string, any>();
  try {
    if (!existsSync(WORKFLOWS_FILE)) return map;
    const raw = readFileSync(WORKFLOWS_FILE, 'utf-8');
    const entries: [string, any][] = JSON.parse(raw);
    for (const [k, v] of entries) map.set(k, v);
  } catch {
    /* ignore corrupt file */
  }
  return map;
}

function wrapWorkflowsStore(real: any) {
  const save = () => {
    try {
      if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
      const entries = Array.from(real.db.workflows.entries());
      writeFileSync(WORKFLOWS_FILE, JSON.stringify(entries));
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

export class DurableInMemoryStore extends InMemoryStore {
  private _workflows?: any;

  async getStore(key: any) {
    if (key === 'workflows') {
      if (!this._workflows) {
        const real: any = await super.getStore('workflows');
        // Restore persisted snapshots into the live in-memory Map.
        const saved = loadWorkflowsFile();
        for (const [k, v] of saved) {
          try {
            real?.db?.workflows?.set(k, v);
          } catch {
            /* skip unloadable entry */
          }
        }
        this._workflows = wrapWorkflowsStore(real);
      }
      return this._workflows;
    }
    return super.getStore(key);
  }
}
