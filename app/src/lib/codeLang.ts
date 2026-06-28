import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { getLegacyCompletions } from "./codeCompletions";

async function langWithCompletions(
  mod: Promise<Record<string, unknown>>,
  key: string,
  ext: string,
): Promise<Extension[]> {
  const m = await mod;
  const lang = StreamLanguage.define(m[key] as import("@codemirror/language").StreamParser<unknown>);
  const source = getLegacyCompletions(ext);
  if (!source) return [lang];
  return [lang, lang.data.of({ autocomplete: source })];
}

export async function getLanguageExtension(filePath: string): Promise<Extension[]> {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "js": case "jsx": case "ts": case "tsx": case "mjs": case "cjs": case "mts": case "cts": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript({ jsx: ext.endsWith("x"), typescript: ext.startsWith("t") })];
    }
    case "py": {
      const { python } = await import("@codemirror/lang-python");
      return [python()];
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return [json()];
    }
    case "rs": {
      const { rust } = await import("@codemirror/lang-rust");
      return [rust()];
    }
    case "html": case "htm": {
      const { html } = await import("@codemirror/lang-html");
      return [html()];
    }
    case "css": case "scss": case "sass": case "less": {
      const { css } = await import("@codemirror/lang-css");
      return [css()];
    }
    case "xml": case "svg": case "plist": {
      const { xml } = await import("@codemirror/lang-xml");
      return [xml()];
    }
    case "md": case "mdx": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return [markdown()];
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql");
      return [sql()];
    }
    case "yaml": case "yml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return [yaml()];
    }
    case "sh": case "bash": case "zsh":
      return langWithCompletions(
        import("@codemirror/legacy-modes/mode/shell") as Promise<Record<string, unknown>>,
        "shell", ext,
      );
    case "go":
      return langWithCompletions(
        import("@codemirror/legacy-modes/mode/go") as Promise<Record<string, unknown>>,
        "go", ext,
      );
    case "java":
      return langWithCompletions(
        import("@codemirror/legacy-modes/mode/clike") as Promise<Record<string, unknown>>,
        "java", ext,
      );
    case "c": case "cpp": case "cc": case "cxx": case "h": case "hpp":
      return langWithCompletions(
        import("@codemirror/legacy-modes/mode/clike") as Promise<Record<string, unknown>>,
        "cpp", ext,
      );
    default:
      return [];
  }
}
