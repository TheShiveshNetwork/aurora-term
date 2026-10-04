import { describe, expect, it } from "vitest";
import {
  deriveSessionPreview,
  generatePlaceholderTitle,
  isPlaceholderTitle,
} from "./sessionTitle";

describe("generatePlaceholderTitle", () => {
  it("produces a zero-padded session_NNNN name", () => {
    expect(generatePlaceholderTitle()).toMatch(/^session_\d{4}$/);
  });

  it("stays inside the four-digit range", () => {
    for (let i = 0; i < 500; i++) {
      const value = Number(generatePlaceholderTitle().slice("session_".length));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10_000);
    }
  });

  it("does not always return the same value", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePlaceholderTitle()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("isPlaceholderTitle", () => {
  it("separates placeholders from agent-written titles", () => {
    expect(isPlaceholderTitle("session_0042")).toBe(true);
    expect(isPlaceholderTitle("Fix auth token refresh")).toBe(false);
    expect(isPlaceholderTitle(undefined)).toBe(false);
    expect(isPlaceholderTitle("")).toBe(false);
  });
});

describe("deriveSessionPreview", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(deriveSessionPreview("a\n\n  b   c")).toBe("a b c");
    const long = deriveSessionPreview("x".repeat(500), 10);
    expect(long).toBe(`${"x".repeat(10)}…`);
  });

  it("returns null for an empty goal", () => {
    expect(deriveSessionPreview("  ")).toBeNull();
  });
});