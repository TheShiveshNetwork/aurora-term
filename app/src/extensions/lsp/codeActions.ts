import type { LSPClient, LSPPlugin } from "@codemirror/lsp-client";
import { EditorView } from "@codemirror/view";

interface CodeActionItem {
  title: string;
  kind?: string;
  edit?: any;
  command?: { command: string; title?: string; arguments?: any[] };
  isPreferred?: boolean;
}

export async function runCodeActions(
  view: EditorView,
  client: LSPClient,
  plugin: LSPPlugin,
  only?: string[],
): Promise<void> {
  const uri = plugin.uri;
  const sel = view.state.selection.main;
  const range = {
    start: plugin.toPosition(sel.from),
    end: plugin.toPosition(sel.to),
  };

  client.sync();

  const result = await client.request("textDocument/codeAction", {
    textDocument: { uri },
    range,
    context: { diagnostics: [], only },
  });

  const actions: CodeActionItem[] = Array.isArray(result) ? (result as CodeActionItem[]) : [];
  if (!actions.length) return;

  showCodeActionMenu(view, actions, (item) => applyCodeAction(view, client, plugin, item));
}

function applyCodeAction(view: EditorView, client: LSPClient, plugin: LSPPlugin, item: CodeActionItem): void {
  if (item.edit) applyWorkspaceEdit(view, plugin, item.edit);

  const cmd = item.command;
  if (cmd && cmd.command) {
    client
      .request("workspace/executeCommand", { command: cmd.command, arguments: cmd.arguments ?? [] })
      .catch((err) => console.error("workspace/executeCommand failed:", err));
  }
}

function applyWorkspaceEdit(view: EditorView, plugin: LSPPlugin, edit: any): void {
  const uri = plugin.uri;
  const changes: { from: number; to: number; insert: string }[] = [];

  const collect = (targetUri: string, edits: any[]) => {
    if (targetUri !== uri) {
      console.warn("Skipping workspace edit for non-active file:", targetUri);
      return;
    }
    for (const te of edits) {
      const from = plugin.fromPosition(te.range.start);
      const to = plugin.fromPosition(te.range.end);
      changes.push({ from, to, insert: te.newText });
    }
  };

  if (edit.changes) {
    for (const u of Object.keys(edit.changes)) collect(u, edit.changes[u]);
  }
  if (edit.documentChanges) {
    for (const dc of edit.documentChanges) {
      if (dc.textDocument && dc.edits) collect(dc.textDocument.uri, dc.edits);
    }
  }

  if (changes.length) {
    view.dispatch({ changes });
  }
}

function showCodeActionMenu(
  view: EditorView,
  actions: CodeActionItem[],
  onPick: (item: CodeActionItem) => void,
): void {
  const coords = view.coordsAtPos(view.state.selection.main.head);
  if (!coords) return;

  const menu = document.createElement("div");
  menu.className = "cm-code-action-menu";

  for (const item of actions) {
    const btn = document.createElement("button");
    btn.className = "cm-code-action-item";
    btn.textContent = item.title;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanup();
      onPick(item);
    });
    menu.appendChild(btn);
  }

  menu.style.position = "fixed";
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.min(coords.left, window.innerWidth - rect.width - 8);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${coords.bottom + 4}px`;

  const onDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) cleanup();
  };
  const cleanup = () => {
    if (menu.parentNode) menu.parentNode.removeChild(menu);
    window.removeEventListener("mousedown", onDown, true);
  };

  setTimeout(() => window.addEventListener("mousedown", onDown, true), 0);
}
