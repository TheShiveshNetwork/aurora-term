import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { historySearchTool } from '../src/tools/history_search';

// Redirects the Windows PSReadLine path via APPDATA; skipped on other platforms.
const FAKE_APPDATA = path.resolve(process.cwd(), 'temp_history_test_home', 'AppData', 'Roaming');
const HISTORY_DIR = path.join(FAKE_APPDATA, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine');

describe.skipIf(process.platform !== 'win32')('historySearchTool', () => {
  let origAppdata: string | undefined;

  beforeAll(() => {
    origAppdata = process.env.APPDATA;
    process.env.APPDATA = FAKE_APPDATA;
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(HISTORY_DIR, 'ConsoleHost_history.txt'),
      ['git status', 'cargo test --workspace', 'pnpm build', 'git status'].join('\n'),
      'utf8'
    );
  });

  afterAll(() => {
    if (origAppdata === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = origAppdata;
    fs.rmSync(path.dirname(FAKE_APPDATA), { recursive: true, force: true });
  });

  it('finds matching commands case-insensitively, de-duplicated', async () => {
    const res = await historySearchTool.execute({ query: 'GIT' });
    expect(res.success).toBe(true);
    expect(res.results).toEqual(['git status']);
  });

  it('returns newest-first and respects limit', async () => {
    const res = await historySearchTool.execute({ query: '', limit: 2 });
    expect(res.success).toBe(true);
    expect(res.results).toHaveLength(2);
    // Dedup keeps each command's most recent position.
    expect(res.results).toEqual(['git status', 'pnpm build']);
  });

  it('succeeds with empty results when nothing matches', async () => {
    const res = await historySearchTool.execute({ query: 'does-not-exist-anywhere' });
    expect(res).toEqual({ success: true, results: [] });
  });

  it('strips zsh extended-history prefixes', async () => {
    fs.writeFileSync(
      path.join(HISTORY_DIR, 'ConsoleHost_history.txt'),
      ': 1721111111:0;git push origin main',
      'utf8'
    );
    const res = await historySearchTool.execute({ query: 'push' });
    expect(res.results).toEqual(['git push origin main']);
  });
});
