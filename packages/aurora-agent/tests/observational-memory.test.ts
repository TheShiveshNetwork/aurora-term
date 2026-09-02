import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import {
  memoryStorage,
  OBSERVATIONAL_MEMORY_ENABLED,
  resolveObserverModel,
} from '../src/agents/shared/memory';

describe('observational memory integration', () => {
  it('enables observational memory in the app config', () => {
    expect(OBSERVATIONAL_MEMORY_ENABLED).toBe(true);
  });

  it('resolves an observer model string', () => {
    expect(typeof resolveObserverModel()).toBe('string');
    expect(resolveObserverModel().length).toBeGreaterThan(0);
  });

  it('uses a libSQL store that supports observational memory', async () => {
    await memoryStorage.init();
    const store = await memoryStorage.getStore('memory');
    expect(store?.supportsObservationalMemory).toBe(true);
  });

  it('round-trips messages through a file-backed libSQL store (native persistence)', async () => {
    const dir = join(process.cwd(), `.aurora-om-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const dbUrl = `file:${join(dir, 'persist.db')}`;
    const store = new LibSQLStore({ id: 'om-test', url: dbUrl });
    await store.init();

    const mem = new Memory({
      storage: store,
      options: {
        lastMessages: 5,
        observationalMemory: { enabled: true, model: 'google/gemini-2.5-flash' },
      },
    });

    await mem.saveMessages({
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          resourceId: 'r1',
          role: 'user',
          content: {
            format: 2,
            parts: [{ type: 'text', text: 'remember: blue is my favorite color' }],
          },
          createdAt: new Date(),
        } as any,
      ],
    });

    // Re-open a brand new store on the exact same file to prove durability.
    const reopened = new LibSQLStore({ id: 'om-test-2', url: dbUrl });
    await reopened.init();
    const mem2 = new Memory({ storage: reopened });
    const ms = await mem2.getMemoryStore();
    const result = await ms.listMessages({ threadId: 't1', resourceId: 'r1' });

    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result.messages[0].content)).toContain('blue is my favorite color');

    // Best-effort cleanup (libSQL may hold a lock on the WAL).
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
