import { describe, expect, it } from 'vitest';
import { cleanTitle } from '../src/agents/shared/session-title';

describe('cleanTitle', () => {
  it('title-cases a plain answer', () => {
    expect(cleanTitle('fix auth token refresh')).toBe('Fix Auth Token Refresh');
  });

  it('strips quotes, markdown fences and trailing punctuation', () => {
    expect(cleanTitle('"Migrate billing to Stripe"')).toBe('Migrate Billing To Stripe');
    expect(cleanTitle('```\nAdd Retry Backoff\n```')).toBe('Add Retry Backoff');
    expect(cleanTitle('Add retry backoff.')).toBe('Add Retry Backoff');
  });

  it('drops a chatty preamble and keeps the trailing title', () => {
    expect(cleanTitle('Sure! Here is a title: Fix Auth Token Refresh')).toBe(
      'Fix Auth Token Refresh',
    );
    expect(cleanTitle('Title: Add Retry Backoff')).toBe('Add Retry Backoff');
  });

  it('caps the word count at six and clamps the length', () => {
    const long = cleanTitle(Array.from({ length: 20 }, (_, i) => `word${i}`).join(' '));
    expect(long!.split(' ')).toHaveLength(6);

    const huge = cleanTitle('x'.repeat(200));
    expect(huge!.length).toBeLessThanOrEqual(60);
  });

  it('rejects empty and single-character output', () => {
    expect(cleanTitle('')).toBeNull();
    expect(cleanTitle('   \n  ')).toBeNull();
    expect(cleanTitle('"')).toBeNull();
    expect(cleanTitle('a')).toBeNull();
  });
});
