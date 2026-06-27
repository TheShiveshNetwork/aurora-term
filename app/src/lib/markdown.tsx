import React from "react";

export function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let key = 0;
  const remaining = text.replace(/\*\*(.+?)\*\*/g, (_, content) => {
    parts.push(<strong key={key++} className="font-semibold text-on-surface">{content}</strong>);
    return "";
  });
  if (remaining) parts.push(<span key={key}>{remaining}</span>);
  return parts;
}

export function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = "";

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={key++} className="bg-surface-container-lowest/60 rounded-lg p-3 my-2 overflow-x-auto text-xs leading-relaxed font-mono text-on-surface/90 border border-outline-variant/10">
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
        codeLang = "";
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={key++} className="flex items-start gap-2 text-sm text-on-surface/80 py-0.5">
          <span className="text-primary mt-1.5 shrink-0 w-1 h-1 rounded-full bg-on-surface-variant/40" />
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      elements.push(
        <div key={key++} className="flex items-start gap-2 text-sm text-on-surface/80 py-0.5">
          <span className="text-on-surface-variant/60 shrink-0 w-4 text-right text-xs">{line.match(/^\d+/)?.[0]}.</span>
          <span>{renderInline(line.replace(/^\d+\.\s/, ""))}</span>
        </div>
      );
      continue;
    }
    elements.push(
      <p key={key++} className="text-sm text-on-surface/80 leading-relaxed py-0.5">
        {renderInline(line)}
      </p>
    );
  }

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key={key++} className="bg-surface-container-lowest/60 rounded-lg p-3 my-2 overflow-x-auto text-xs leading-relaxed font-mono text-on-surface/90 border border-outline-variant/10">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }

  return elements;
}
