import { describe, expect, it } from "vitest";
import { changeBadge } from "./changeBadge";

describe("changeBadge", () => {
  it("marks a write as Added (green A)", () => {
    const badge = changeBadge({ type: "write" }, false);
    expect(badge.letter).toBe("A");
    expect(badge.label).toBe("Added");
    expect(badge.tone).toContain("emerald");
  });

  it("marks a patch as Modified (yellow M)", () => {
    const badge = changeBadge({ type: "patch" }, false);
    expect(badge.letter).toBe("M");
    expect(badge.label).toBe("Modified");
    expect(badge.tone).toContain("amber");
  });

  it("marks a missing file as Deleted (red D)", () => {
    const badge = changeBadge({ type: "write" }, true);
    expect(badge.letter).toBe("D");
    expect(badge.label).toBe("Deleted");
    expect(badge.tone).toContain("red");
  });

  it("prefers Deleted over the tool kind when the file is gone", () => {
    expect(changeBadge({ type: "patch" }, true).letter).toBe("D");
  });

  it("treats a missing type as a write", () => {
    expect(changeBadge({}, false).letter).toBe("A");
  });

  it("gives every kind a distinct colour", () => {
    const tones = [
      changeBadge({ type: "write" }, false).tone,
      changeBadge({ type: "patch" }, false).tone,
      changeBadge({ type: "write" }, true).tone,
    ];
    expect(new Set(tones).size).toBe(3);
  });
});
