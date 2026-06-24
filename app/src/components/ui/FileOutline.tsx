import React, { useMemo } from "react";
import { FunctionSquare, Braces, Type, Code, Component, Variable, Package } from "lucide-react";

interface OutlineSymbol {
  name: string;
  type: "function" | "class" | "interface" | "type" | "component" | "variable" | "import";
  line: number;
  depth: number;
}

const FUNCTION_RE = /^\s*(?:export\s+)?(?:async\s+)?function\s+(?:\*\s+)?(\w+)/;
const ARROW_FN_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|[\w_])/;
const CLASS_RE = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;
const INTERFACE_RE = /^\s*(?:export\s+)?interface\s+(\w+)/;
const TYPE_RE = /^\s*(?:export\s+)?type\s+(\w+)/;
const COMPONENT_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]\s*(?:React\.)?(?:FC|FunctionComponent)/;
const IMPORT_RE = /^\s*import\s+(?:\{\s*)?(\w+)/;

function parseOutline(content: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let match: RegExpMatchArray | null;

    match = line.match(CLASS_RE);
    if (match) {
      symbols.push({ name: match[1], type: "class", line: i + 1, depth: 0 });
      continue;
    }

    match = line.match(INTERFACE_RE);
    if (match) {
      symbols.push({ name: match[1], type: "interface", line: i + 1, depth: 0 });
      continue;
    }

    match = line.match(TYPE_RE);
    if (match) {
      symbols.push({ name: match[1], type: "type", line: i + 1, depth: 0 });
      continue;
    }

    match = line.match(FUNCTION_RE);
    if (match) {
      symbols.push({ name: match[1], type: "function", line: i + 1, depth: 0 });
      continue;
    }

    match = line.match(COMPONENT_RE);
    if (match) {
      symbols.push({ name: match[1], type: "component", line: i + 1, depth: 0 });
      continue;
    }

    match = line.match(ARROW_FN_RE);
    if (match) {
      symbols.push({ name: match[1], type: "function", line: i + 1, depth: 0 });
      continue;
    }

    match = line.match(IMPORT_RE);
    if (match) {
      symbols.push({ name: match[1], type: "import", line: i + 1, depth: 0 });
      continue;
    }
  }

  return symbols;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  function: <FunctionSquare size={11} style={{ color: "#9A7CFF" }} />,
  class: <Braces size={11} style={{ color: "#42C6FF" }} />,
  interface: <Type size={11} style={{ color: "#FFB300" }} />,
  type: <Type size={11} style={{ color: "#FF7043" }} />,
  component: <Component size={11} style={{ color: "#4F8CFF" }} />,
  variable: <Variable size={11} style={{ color: "rgba(232,234,240,0.45)" }} />,
  import: <Package size={11} style={{ color: "rgba(232,234,240,0.3)" }} />,
};

export function FileOutline({ filePath, fileContent }: { filePath?: string; fileContent?: string }) {
  const symbols = useMemo(() => {
    if (!fileContent) return [];
    return parseOutline(fileContent);
  }, [fileContent]);

  if (!filePath) {
    return (
      <div className="px-3 py-2 text-sm" style={{ color: "rgba(232,234,240,0.25)" }}>
        No file open
      </div>
    );
  }

  if (symbols.length === 0) {
    return (
      <div className="px-3 py-2 text-sm" style={{ color: "rgba(232,234,240,0.25)" }}>
        No symbols found
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {symbols.map((sym, i) => (
        <div
          key={`${sym.name}-${sym.line}-${i}`}
          className="flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors"
          style={{ paddingLeft: `${12 + sym.depth * 12}px` }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          title={`Line ${sym.line}`}
        >
          {ICON_MAP[sym.type] || ICON_MAP.variable}
          <span className="truncate text-[12px]" style={{ color: "rgba(232,234,240,0.65)" }}>
            {sym.name}
          </span>
          <span className="ml-auto text-xs font-mono shrink-0" style={{ color: "rgba(232,234,240,0.2)" }}>
            {sym.line}
          </span>
        </div>
      ))}
    </div>
  );
}
