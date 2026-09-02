import { describe, it, expect } from 'vitest';
import {
  WORKING_MEMORY_XML_FRAGILE_MODELS,
  findWorkingMemoryFragileMatch,
} from '../src/working-memory-policy';

describe('working-memory policy (#55)', () => {
  it('checklist is non-empty and lowercase', () => {
    expect(WORKING_MEMORY_XML_FRAGILE_MODELS.length).toBeGreaterThan(0);
    for (const fragment of WORKING_MEMORY_XML_FRAGILE_MODELS) {
      expect(fragment).toBe(fragment.toLowerCase());
    }
  });

  it('flags Groq-hosted Llama models as fragile (the original bug)', () => {
    // These models misinterpret <working_memory> XML as tool-call syntax.
    expect(findWorkingMemoryFragileMatch('groq/llama-3.1-8b-instant')).toBe('llama-3.1');
    expect(findWorkingMemoryFragileMatch('groq/llama-3.3-70b-versatile')).toBe('llama-3.3');
  });

  it('flags Ollama llama tags via the openai-compatible id', () => {
    expect(findWorkingMemoryFragileMatch('openai/llama3.2:3b')).toBe('llama3');
    expect(findWorkingMemoryFragileMatch('openai/llama3.1:8b-instruct-q4_0')).toBe('llama3');
  });

  it('flags NVIDIA NIM Llama hosting', () => {
    // Matches via 'llama-3.1' and/or 'meta/llama' — either way it's flagged.
    expect(findWorkingMemoryFragileMatch('nvidia/meta/llama-3.1-8b-instruct')).not.toBeNull();
    expect(findWorkingMemoryFragileMatch('nvidia/meta/llama-4-scout')).toBe('meta/llama');
  });

  it('is case-insensitive', () => {
    expect(findWorkingMemoryFragileMatch('GROQ/LLAMA-3.1-8B-INSTANT')).toBe('llama-3.1');
  });

  it('does NOT flag non-Llama providers — working memory stays enabled (#55)', () => {
    expect(findWorkingMemoryFragileMatch('anthropic/claude-sonnet-4-6')).toBeNull();
    expect(findWorkingMemoryFragileMatch('openai/gpt-5.4-mini')).toBeNull();
    expect(findWorkingMemoryFragileMatch('google/gemini-3.5-flash')).toBeNull();
    expect(findWorkingMemoryFragileMatch('groq/openai/gpt-oss-120b')).toBeNull();
    expect(findWorkingMemoryFragileMatch('groq/qwen/qwen3.6-27b')).toBeNull();
    expect(findWorkingMemoryFragileMatch(undefined)).toBeNull();
    expect(findWorkingMemoryFragileMatch('')).toBeNull();
  });
});
