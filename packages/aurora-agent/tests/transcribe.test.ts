import { describe, expect, it } from 'vitest';
import { extensionFor, transcribeAudio } from '../src/agents/shared/transcribe';

describe('extensionFor', () => {
  it('maps the container types MediaRecorder can emit', () => {
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/wav')).toBe('wav');
    expect(extensionFor('audio/mpeg')).toBe('mp3');
  });

  it('falls back to webm for anything unrecognised', () => {
    expect(extensionFor('')).toBe('webm');
    expect(extensionFor('application/octet-stream')).toBe('webm');
  });
});

describe('transcribeAudio', () => {
  // No STT provider keys exist in the test environment, so this exercises the
  // guard rather than any network call.
  it('explains what is missing when no provider is configured', async () => {
    const result = await transcribeAudio({ audioBase64: 'AAAA' });
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/Groq or OpenAI API key/i);
  });

  it('rejects an empty recording instead of calling a provider', async () => {
    const result = await transcribeAudio({ audioBase64: '' });
    expect(result.status).toBe('error');
  });

  it('requires a goal-free request to still validate its payload', async () => {
    const result = await transcribeAudio({ audioBase64: '   ', mimeType: 'audio/webm' });
    expect(result.status).toBe('error');
    expect(result.text).toBeUndefined();
  });
});