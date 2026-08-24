import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { INLINED_PROMPTS } from '../src/agents/shared/prompts';

describe('inlined agent prompts match the .txt files', () => {
  const promptsDir = path.resolve(process.cwd(), 'src', 'agents', 'prompts');

  it('every inlined prompt matches its .txt source exactly (trimmed)', () => {
    for (const [filename, inlined] of Object.entries(INLINED_PROMPTS)) {
      const full = path.join(promptsDir, filename);
      expect(fs.existsSync(full), `${filename} missing from src/agents/prompts`).toBe(true);
      const onDisk = fs.readFileSync(full, 'utf8').trim();
      expect(onDisk, `${filename} drifted from the inlined snapshot`).toBe(inlined.trim());
    }
  });

  it('every .txt file has an inlined snapshot', () => {
    const files = fs.readdirSync(promptsDir).filter((f) => f.endsWith('.txt'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(INLINED_PROMPTS[f], `${f} has no INLINED_PROMPTS entry`).toBeDefined();
    }
  });
});
