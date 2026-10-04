import { describe, expect, it } from "vitest";
import { hasUnsavedChanges, normalizeDraft } from "./settingsDirty";

function draft(overrides: Record<string, any> = {}) {
  return {
    config: {
      ai: { active_provider: "openai", require_review_for_writes: true },
      cloud: { auto_sync: false, synced: true },
      editor: { font_size: 13 },
      ...overrides,
    },
    sidebarCollapsed: false,
  };
}

describe("normalizeDraft", () => {
  it("ignores the active provider", () => {
    const a = draft();
    const b = draft();
    b.config.ai.active_provider = "anthropic";
    expect(normalizeDraft(a)).toBe(normalizeDraft(b));
  });

  it("ignores cloud sync state", () => {
    const a = draft();
    const b = draft();
    b.config.cloud.synced = false;
    expect(normalizeDraft(a)).toBe(normalizeDraft(b));
  });

  it("still detects other AI setting changes", () => {
    const a = draft();
    const b = draft();
    b.config.ai.require_review_for_writes = false;
    expect(normalizeDraft(a)).not.toBe(normalizeDraft(b));
  });

  it("does not mutate its input", () => {
    const input = draft();
    normalizeDraft(input);
    expect(input.config.ai.active_provider).toBe("openai");
    expect(input.config.cloud).toBeDefined();
  });

  it("handles a null draft", () => {
    expect(normalizeDraft(null)).toBe("");
  });

  it("tolerates a config without an ai block", () => {
    expect(normalizeDraft({ config: { editor: {} } } as any)).toBeTruthy();
  });
});

describe("hasUnsavedChanges", () => {
  it("is false for an untouched page", () => {
    expect(hasUnsavedChanges(draft(), draft())).toBe(false);
  });

  it("is false when only the provider changed", () => {
    const initial = draft();
    const next = draft();
    next.config.ai.active_provider = "groq";
    expect(hasUnsavedChanges(next, initial)).toBe(false);
  });

  it("is false when only cloud sync state changed", () => {
    const initial = draft();
    const next = draft();
    next.config.cloud.synced = false;
    expect(hasUnsavedChanges(next, initial)).toBe(false);
  });

  it("is true when the provider and another setting both changed", () => {
    const initial = draft();
    const next = draft();
    next.config.ai.active_provider = "groq";
    next.config.editor.font_size = 15;
    expect(hasUnsavedChanges(next, initial)).toBe(true);
  });

  it("is true for a sidebar toggle alone", () => {
    const initial = draft();
    const next = draft();
    next.sidebarCollapsed = true;
    expect(hasUnsavedChanges(next, initial)).toBe(true);
  });

  it("is false when either side is missing", () => {
    expect(hasUnsavedChanges(null, draft())).toBe(false);
    expect(hasUnsavedChanges(draft(), null)).toBe(false);
  });
});
