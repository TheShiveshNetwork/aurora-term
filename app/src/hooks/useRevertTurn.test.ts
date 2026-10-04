import { describe, expect, it } from "vitest";
import { decideRestore } from "./useRevertTurn";

const ORIGINAL = "# project rules\nline two\n";
const WRITTEN = "it is working";

function change(overrides: Partial<Parameters<typeof decideRestore>[1]> = {}) {
  return {
    path: "/repo/.rules",
    previousContent: ORIGINAL,
    writtenContent: WRITTEN,
    toolName: "write_file",
    ...overrides,
  } as Parameters<typeof decideRestore>[1];
}

describe("decideRestore", () => {
  it("restores when the file still holds exactly what the agent wrote", () => {
    expect(decideRestore(WRITTEN, change())).toBe("restore");
  });

  it("refuses when the file was edited after the agent wrote it", () => {
    expect(decideRestore("it is working\nplus my own edit", change())).toBe("conflict");
    expect(decideRestore("", change())).toBe("conflict");
    expect(decideRestore(null, change())).toBe("conflict");
  });

  it("deletes a file the agent created, not restores it", () => {
    expect(
      decideRestore("brand new", change({ previousContent: null, writtenContent: "brand new" })),
    ).toBe("delete");
  });

  it("refuses to delete a created file that was edited afterwards", () => {
    expect(
      decideRestore("brand new + edit", change({ previousContent: null, writtenContent: "brand new" })),
    ).toBe("conflict");
  });

  it("treats a no-op write on an untouched file as a restore", () => {
    expect(decideRestore(ORIGINAL, change({ writtenContent: ORIGINAL }))).toBe("restore");
  });

  it("restores unverified rather than refusing, for records with no written content", () => {
    // This is the regression: comparing against previousContent instead made
    // every real revert report "modified afterwards" and change nothing.
    const legacy = change({ writtenContent: undefined });
    expect(decideRestore(WRITTEN, legacy)).toBe("unverified");
  });

  it("has nothing to do when a created file is already gone", () => {
    expect(
      decideRestore(null, change({ previousContent: null, writtenContent: undefined })),
    ).toBe("restore");
  });
});
