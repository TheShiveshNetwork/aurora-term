import { Memory } from '@mastra/memory';
import { InMemoryStore } from '@mastra/core/storage';
import { DurableInMemoryStore } from './durable-storage';

// Durable so the agentic-loop workflow snapshot survives a sidecar restart
// between suspend (tool approval) and resume (#approval-flow).
export const memoryStorage = new DurableInMemoryStore({
  id: 'aura-memory',
});

// Working memory uses thread scope because InMemoryStore lacks the resources
// table required for resource scope (#55). Fragile-model gating happens
// per-request via working-memory-policy.
export const auraMemory = new Memory({
  storage: memoryStorage,
  options: {
    lastMessages: 20,
    workingMemory: {
      enabled: true,
      scope: 'thread',
    },
  },
});
