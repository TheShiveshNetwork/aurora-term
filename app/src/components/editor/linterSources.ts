import { syntaxTree } from "@codemirror/language";
import type { Diagnostic, LintSource } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

const LEZER_LANGS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts",
  "py", "json", "rs",
  "html", "htm",
  "css", "scss", "sass", "less",
  "xml", "svg", "plist",
  "md", "mdx", "sql", "yaml", "yml",
]);

export function isLezerLang(ext: string): boolean {
  return LEZER_LANGS.has(ext);
}

export function syntaxTreeLinter(): LintSource {
  return (view: EditorView): readonly Diagnostic[] => {
    const tree = syntaxTree(view.state);
    const diagnostics: Diagnostic[] = [];
    tree.iterate({
      enter: (nodeRef) => {
        if (nodeRef.type.isError) {
          const from = nodeRef.from;
          const to = nodeRef.to;
          const text = view.state.sliceDoc(from, Math.min(from + 40, to));
          diagnostics.push({
            from,
            to: Math.max(to, from + 1),
            severity: "error",
            message: text ? `Unexpected token: ${text}` : "Syntax error",
          });
        }
      },
    });
    return diagnostics;
  };
}

export async function getLinterSource(ext: string): Promise<LintSource | null> {
  if (ext === "json") {
    const { jsonParseLinter } = await import("@codemirror/lang-json");
    return jsonParseLinter();
  }
  if (isLezerLang(ext)) {
    return syntaxTreeLinter();
  }
  return null;
}
