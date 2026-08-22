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

export function createLanguageLinter(ext: string): LintSource {
  return (view: EditorView): readonly Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const docText = view.state.doc.toString();

    // 1. Global document regex checks (e.g., HTML duplicate IDs)
    if (ext === "html" || ext === "htm") {
      const idRegex = /\bid\s*=\s*"([^"]+)"/g;
      const seenIds = new Map<string, number[]>();
      let match;
      while ((match = idRegex.exec(docText)) !== null) {
        const id = match[1];
        const index = match.index;
        if (!seenIds.has(id)) {
          seenIds.set(id, []);
        }
        seenIds.get(id)!.push(index);
      }
      for (const [id, indices] of seenIds.entries()) {
        if (indices.length > 1) {
          for (const idx of indices) {
            diagnostics.push({
              from: idx,
              to: idx + `id="${id}"`.length,
              severity: "warning",
              message: `Duplicate ID attribute "${id}"`,
            });
          }
        }
      }
    }

    // 2. Syntax tree based iteration
    const tree = syntaxTree(view.state);
    tree.iterate({
      enter: (nodeRef) => {
        const name = nodeRef.name;
        const from = nodeRef.from;
        const to = nodeRef.to;
        const text = view.state.sliceDoc(from, to);

        // Syntax Error Check (Error)
        // Skip zero-length error nodes — these are transient artifacts of
        // mid-edit parsing (a caret sitting inside an unfinished token) and
        // would otherwise flicker as false positives. Only flag errors that
        // actually span content.
        if (nodeRef.type.isError) {
          if (to <= from) return;
          const shortText = text.slice(0, 40);
          diagnostics.push({
            from,
            to,
            severity: "error",
            message: shortText ? `Unexpected token: ${shortText}` : "Syntax error",
          });
          return;
        }

        // JS/TS Lint Rules (Warning / Info)
        if (ext === "js" || ext === "jsx" || ext === "ts" || ext === "tsx") {
          if (name === "VariableDeclaration" && text.startsWith("var ")) {
            diagnostics.push({
              from,
              to,
              severity: "warning",
              message: "var is discouraged; use let or const instead",
            });
          }
          if (name === "DebuggerStatement") {
            diagnostics.push({
              from,
              to,
              severity: "warning",
              message: "Use of debugger statement",
            });
          }
          if (name === "CallExpression" && (text.startsWith("console.log") || text.startsWith("console.error") || text.startsWith("console.warn"))) {
            diagnostics.push({
              from,
              to,
              severity: "info",
              message: "Console logging statement",
            });
          }
          if (name === "CatchClause") {
            const bodyIdx = text.indexOf("{");
            if (bodyIdx !== -1) {
              const body = text.slice(bodyIdx);
              if (body.replace(/\s/g, "") === "{}") {
                diagnostics.push({
                  from,
                  to,
                  severity: "warning",
                  message: "Empty catch block (errors are swallowed)",
                });
              }
            }
          }
        }

        // Python Lint Rules (Warning / Info)
        if (ext === "py") {
          if (name === "CallExpression" && text.startsWith("print")) {
            diagnostics.push({
              from,
              to,
              severity: "info",
              message: "Print statement found",
            });
          }
          if (name === "ExceptClause" && text.trim().startsWith("except:")) {
            diagnostics.push({
              from,
              to,
              severity: "warning",
              message: "Bare except clause (swallows all exceptions)",
            });
          }
          if (name === "CallExpression" && (text.startsWith("eval") || text.startsWith("exec"))) {
            diagnostics.push({
              from,
              to,
              severity: "warning",
              message: "Avoid eval()/exec() for security reasons",
            });
          }
        }

        // HTML Lint Rules (Warning / Info)
        if (ext === "html" || ext === "htm") {
          if (name === "SelfClosingTag" || name === "Element") {
            const tagText = text.toLowerCase();
            if (tagText.startsWith("<img") && !tagText.includes("alt=")) {
              diagnostics.push({
                from,
                to,
                severity: "warning",
                message: "Missing alt attribute on <img> (accessibility)",
              });
            }
          }
        }

        // CSS Lint Rules (Warning / Info)
        if (ext === "css" || ext === "scss") {
          if (name === "RuleSet") {
            const bodyStart = text.indexOf("{");
            if (bodyStart !== -1) {
              const body = text.slice(bodyStart + 1, text.lastIndexOf("}"));
              if (!body.trim()) {
                diagnostics.push({
                  from,
                  to,
                  severity: "warning",
                  message: "Empty ruleset",
                });
              }
            }
          }
          if (name === "Important") {
            diagnostics.push({
              from,
              to,
              severity: "info",
              message: "Avoid using !important",
            });
          }
        }

        // Rust Lint Rules (Warning / Info)
        if (ext === "rs") {
          if (text.includes("todo!") || text.includes("unimplemented!")) {
            diagnostics.push({
              from,
              to,
              severity: "warning",
              message: "Contains todo! or unimplemented! placeholder",
            });
          }
        }

        // TODO/FIXME check in comments across all files
        if (name.toLowerCase().includes("comment") && (text.includes("TODO") || text.includes("FIXME"))) {
          diagnostics.push({
            from,
            to,
            severity: "info",
            message: text.includes("TODO") ? "TODO comment found" : "FIXME comment found",
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
    return createLanguageLinter(ext);
  }
  return null;
}
