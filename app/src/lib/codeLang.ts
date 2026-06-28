import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { go } from "@codemirror/legacy-modes/mode/go";
import { java, cpp } from "@codemirror/legacy-modes/mode/clike";
import type { Extension } from "@codemirror/state";
import { getLegacyCompletions } from "./codeCompletions";

function langWithCompletions(lang: ReturnType<typeof StreamLanguage.define>, ext: string): Extension[] {
  const source = getLegacyCompletions(ext);
  if (!source) return [lang];
  return [lang, lang.data.of({ autocomplete: source })];
}

export function getLanguageExtension(filePath: string): Extension {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "js": case "jsx": case "ts": case "tsx": case "mjs": case "cjs": case "mts": case "cts":
      return javascript({ jsx: ext.endsWith("x"), typescript: ext.startsWith("t") });
    case "py": return python();
    case "json": return json();
    case "rs": return rust();
    case "html": case "htm": return html();
    case "css": case "scss": case "sass": case "less": return css();
    case "xml": case "svg": case "plist": return xml();
    case "md": case "mdx": return markdown();
    case "sql": return sql();
    case "yaml": case "yml": return yaml();
    case "sh": case "bash": case "zsh": return langWithCompletions(StreamLanguage.define(shell), ext);
    case "go": return langWithCompletions(StreamLanguage.define(go), ext);
    case "java": return langWithCompletions(StreamLanguage.define(java), ext);
    case "c": case "cpp": case "cc": case "cxx": case "h": case "hpp": return langWithCompletions(StreamLanguage.define(cpp), ext);
    default: return [];
  }
}
