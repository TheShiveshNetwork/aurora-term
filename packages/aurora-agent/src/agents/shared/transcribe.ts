import { getRuntimeSettings } from '../../runtime-settings';
import { rootLogger } from '../../logger';

const log = rootLogger.child({ module: 'transcribe' });

const TIMEOUT_MS = 60_000;

/**
 * Transcription providers, in preference order.
 *
 * Chromium's `webkitSpeechRecognition` cannot be used inside the Tauri webview —
 * it proxies to Google's cloud speech backend and fails with a `network` error —
 * so voice input is recorded locally and sent here instead. These endpoints are
 * OpenAI-compatible, which covers the providers a user is likely to have already
 * configured a key for.
 */
const PROVIDERS = [
  {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3',
  },
  {
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
  },
] as const;

export interface TranscribeRequest {
  audioBase64: string;
  mimeType?: string;
  language?: string;
}

export interface TranscribeResult {
  status: 'ok' | 'error';
  text?: string;
  provider?: string;
  message?: string;
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mpeg')) return 'mp3';
  return 'webm';
}

export function configuredTranscriber() {
  const { apiKeys } = getRuntimeSettings();
  for (const provider of PROVIDERS) {
    const key = apiKeys[provider.name];
    if (key) return { ...provider, key };
  }
  return null;
}

export async function transcribeAudio(request: TranscribeRequest): Promise<TranscribeResult> {
  const provider = configuredTranscriber();
  if (!provider) {
    return {
      status: 'error',
      message:
        'Voice input needs a speech-to-text provider. Add a Groq or OpenAI API key in Settings → AI.',
    };
  }

  const mimeType = request.mimeType || 'audio/webm';
  let bytes: Buffer;
  try {
    bytes = Buffer.from(request.audioBase64, 'base64');
  } catch {
    return { status: 'error', message: 'Audio payload was not valid base64.' };
  }
  if (bytes.length === 0) {
    return { status: 'error', message: 'No audio was captured.' };
  }

  const form = new FormData();
  // Copied into a plain Uint8Array: a Node Buffer may be backed by a
  // SharedArrayBuffer, which Blob rejects.
  const part = new Uint8Array(bytes.byteLength);
  part.set(bytes);
  form.append(
    'file',
    new Blob([part], { type: mimeType }),
    `recording.${extensionFor(mimeType)}`,
  );
  form.append('model', provider.model);
  if (request.language) form.append('language', request.language);
  form.append('response_format', 'json');

  try {
    const response = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.key}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      log.warn('Transcription provider rejected the request', {
        provider: provider.name,
        status: response.status,
        detail,
      });
      return {
        status: 'error',
        message: `Transcription failed (${response.status}): ${detail || response.statusText}`,
      };
    }

    const payload: any = await response.json();
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) return { status: 'error', message: 'Transcription returned no text.' };

    log.info('Transcribed audio', {
      provider: provider.name,
      bytes: bytes.length,
      chars: text.length,
    });
    return { status: 'ok', text, provider: provider.name };
  } catch (error: any) {
    log.warn('Transcription request failed', { provider: provider.name, error: error?.message });
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      status: 'error',
      message: timedOut
        ? 'Transcription timed out. Try a shorter recording.'
        : `Could not reach the transcription provider: ${error?.message ?? 'unknown error'}`,
    };
  }
}