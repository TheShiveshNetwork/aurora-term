import { beforeEach, describe, expect, it } from "vitest";
import {
  isAbsolutePath,
  projectRelativePath,
  resolveAgentPath,
} from "./agentPaths";
import { useAppShellStore } from "../stores/useAppShellStore";

function setProject(path: string, cwd = "") {
  useAppShellStore.setState({ projectDir: path, cwdAbsolute: cwd });
}

describe("isAbsolutePath", () => {
  it("recognises drive, UNC and POSIX roots", () => {
    expect(isAbsolutePath("D:\\builds\\aurora\\.rules")).toBe(true);
    expect(isAbsolutePath("C:/Users/x/file.ts")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share\\f.txt")).toBe(true);
    expect(isAbsolutePath("/home/x/f.txt")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isAbsolutePath(".rules")).toBe(false);
    expect(isAbsolutePath("src/app/main.ts")).toBe(false);
    expect(isAbsolutePath("./src/app/main.ts")).toBe(false);
  });
});

describe("resolveAgentPath", () => {
  beforeEach(() => setProject("", ""));

  it("passes absolute paths through untouched", () => {
    setProject("D:\\builds\\aurora");
    expect(resolveAgentPath("D:\\other\\file.ts")).toBe("D:\\other\\file.ts");
  });

  it("resolves a bare relative path against the project dir", () => {
    setProject("D:\\builds\\aurora");
    expect(resolveAgentPath(".rules")).toBe("D:\\builds\\aurora\\.rules");
  });

  it("resolves nested relative paths and normalises separators", () => {
    setProject("D:\\builds\\aurora");
    expect(resolveAgentPath("src/app/main.ts")).toBe("D:\\builds\\aurora\\src\\app\\main.ts");
    expect(resolveAgentPath("src\\app\\main.ts")).toBe("D:\\builds\\aurora\\src\\app\\main.ts");
  });

  it("strips a leading ./ but not a parent reference", () => {
    setProject("D:\\builds\\aurora");
    expect(resolveAgentPath("./.rules")).toBe("D:\\builds\\aurora\\.rules");
    expect(resolveAgentPath("../outside.txt")).toBe("D:\\builds\\aurora\\..\\outside.txt");
  });

  it("falls back to cwdAbsolute when no project dir is set", () => {
    setProject("", "/home/dev/myrepo");
    expect(resolveAgentPath("notes.md")).toBe("/home/dev/myrepo/notes.md");
  });

  it("prefers projectDir over cwdAbsolute", () => {
    setProject("D:\\builds\\aurora", "/home/dev/other");
    expect(resolveAgentPath("a.txt")).toBe("D:\\builds\\aurora\\a.txt");
  });

  it("uses forward slashes when the base is posix", () => {
    setProject("/home/dev/repo");
    expect(resolveAgentPath("src/main.ts")).toBe("/home/dev/repo/src/main.ts");
  });

  it("does not double up separators on a trailing-slash base", () => {
    setProject("D:\\builds\\aurora\\");
    expect(resolveAgentPath(".rules")).toBe("D:\\builds\\aurora\\.rules");
  });

  it("returns the input unchanged when there is no base to resolve against", () => {
    setProject("", "");
    expect(resolveAgentPath(".rules")).toBe(".rules");
    expect(resolveAgentPath("  ")).toBe("");
  });
});

describe("projectRelativePath", () => {
  beforeEach(() => setProject("D:\\builds\\aurora", ""));

  it("strips the project root from a nested file", () => {
    expect(projectRelativePath("D:\\builds\\aurora\\src\\app\\main.ts")).toBe(
      "src/app/main.ts",
    );
  });

  it("strips the project root from a file at the root", () => {
    expect(projectRelativePath("D:\\builds\\aurora\\IMWORKING.md")).toBe("IMWORKING.md");
  });

  it("matches case-insensitively on Windows drive paths", () => {
    expect(projectRelativePath("d:\\builds\\AURORA\\src\\main.ts")).toBe("src/main.ts");
  });

  it("does not treat a sibling folder as inside the project", () => {
    expect(projectRelativePath("D:\\builds\\aurora-other\\src\\main.ts")).toBe(
      "D:/builds/aurora-other/src/main.ts",
    );
  });

  it("keeps the absolute path when the file is outside the project", () => {
    expect(projectRelativePath("C:\\Users\\me\\notes.md")).toBe("C:/Users/me/notes.md");
  });

  it("leaves an already-relative path untouched", () => {
    expect(projectRelativePath("src/app/main.ts")).toBe("src/app/main.ts");
    expect(projectRelativePath(".rules")).toBe(".rules");
  });

  it("handles a posix project root", () => {
    setProject("/home/dev/repo", "");
    expect(projectRelativePath("/home/dev/repo/src/main.ts")).toBe("src/main.ts");
    expect(projectRelativePath("/home/dev/other/main.ts")).toBe("/home/dev/other/main.ts");
  });

  it("falls back to the absolute path when no project is open", () => {
    setProject("", "");
    expect(projectRelativePath("D:\\x\\y.ts")).toBe("D:/x/y.ts");
  });

  it("accepts an explicit base", () => {
    setProject("", "");
    expect(projectRelativePath("/srv/app/index.js", "/srv/app")).toBe("index.js");
  });
});
