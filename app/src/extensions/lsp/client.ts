import type { Extension, Text } from "@codemirror/state";
import type { LSPClient as LspClientType, LSPPlugin } from "@codemirror/lsp-client";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EditorView, keymap } from "@codemirror/view";
import { tauriTransport } from "./transport";
import { pathToUri, uriToPath, languageIdFromPath } from "./languageId";
import { runCodeActions } from "./codeActions";
import { lspClickable } from "./clickable";
import { openFileInApp } from "../../lib/openFileRef";
import { system } from "../../lib/ipc";
import { useLoaderStore } from "../../stores/useLoaderStore";
import { notify } from "../../lib/notify";
import { centerOnRange } from "../../lib/editorScroll";
import { pathsEqual } from "../../lib/fileUtils";

// One connected client per `(language, project root)` server. The heavy
// `@codemirror/lsp-client` package is dynamically imported here so it lands in
// its own bundle chunk and never bloats the initial editor load.
const clients = new Map<string, Promise<LspClientType>>();

// Server keys (`"{languageId}|{root}"`) that currently have a connected (or
// connecting) LSP client. Used by the editor to suppress the lighter built-in
// Lezer linter for those files.
const activeServers = new Set<string>();

// Holds the dynamically imported module so the synchronous command helpers
// below can reach the library's `jumpToDefinition`/`LSPPlugin` at runtime.
let lspMod: typeof import("@codemirror/lsp-client") | null = null;

// ── Single `lsp-message` channel routing ──────────────────────────────────────
// `server_key` carries `|` and Windows path separators, which are illegal in
// Tauri event names, so we cannot open one channel per server. Instead every
// server message (and server-loss notification) is emitted on one `lsp-message`
// channel carrying the full payload; this module registers a single listener
// and dispatches by `server_key`.
interface LspIncomingPayload {
  language_id: string;
  server_key: string;
  message: string;
  closed: boolean;
}

const messageHandlers = new Map<string, Set<(msg: string) => void>>();
let globalLspListener: UnlistenFn | null = null;
let lspListenerPromise: Promise<UnlistenFn> | null = null;

export function ensureLspListener(): Promise<void> {
  if (globalLspListener) return Promise.resolve();
  if (!lspListenerPromise) {
    lspListenerPromise = listen<LspIncomingPayload>("lsp-message", (ev) => {
      const p = ev.payload;
      if (p.closed) {
        handleServerClosed(p.server_key);
        return;
      }
      const handlers = messageHandlers.get(p.server_key);
      if (handlers) handlers.forEach((h) => h(p.message));
    });
  }
  return lspListenerPromise.then((fn) => {
    globalLspListener = fn;
  });
}

export function registerLspHandler(serverKey: string, handler: (msg: string) => void): void {
  let set = messageHandlers.get(serverKey);
  if (!set) {
    set = new Set();
    messageHandlers.set(serverKey, set);
  }
  set.add(handler);
}

export function unregisterLspHandler(serverKey: string, handler: (msg: string) => void): void {
  const set = messageHandlers.get(serverKey);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) messageHandlers.delete(serverKey);
}

// Drop a client when its server is gone so the editor falls back to the lighter
// Lezer linter instead of hanging on a dead pipe.
function handleServerClosed(serverKey: string): void {
  const promise = clients.get(serverKey);
  clients.delete(serverKey);
  activeServers.delete(serverKey);
  messageHandlers.delete(serverKey);
  if (promise) promise.then((c) => c.disconnect()).catch(() => {});
}

export function isLspActive(languageId: string): boolean {
  const prefix = `${languageId}|`;
  for (const key of activeServers) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function rootUriFor(root: string | null, filePath: string): string {
  if (root) return pathToUri(root);
  const dir = filePath.replace(/[\\/][^\\/]*$/, "");
  return pathToUri(dir || filePath);
}

async function getOrConnectClient(serverKey: string, rootUri: string): Promise<LspClientType> {
  const existing = clients.get(serverKey);
  if (existing) return existing;

  const promise = (async () => {
    const mod = await import("@codemirror/lsp-client");
    lspMod = mod;
    const { AuroraWorkspace: WorkspaceImpl } = await import("./workspace");

    const languageId = serverKey.split("|")[0];
    const client = new mod.LSPClient({
      rootUri,
      extensions: mod.languageServerExtensions(),
      workspace: (c) => new WorkspaceImpl(c),
      // The library defaults to a 3s request timeout, which is far too short
      // for `textDocument/definition` while a server is indexing/re-indexing
      // (e.g. right after a code change). Bump it so Ctrl+click doesn't fail
      // with "Request timed out" on a slow-but-live server.
      timeout: 30_000,
    }).connect(tauriTransport(serverKey));

    activeServers.add(serverKey);

    return client;
  })();

  clients.set(serverKey, promise);
  return promise;
}

// Ensure the server is fetched + spawned, then connect a client for this
// language and return the plugin extension (plus Ctrl+click and code-action
// bindings) bound to `filePath`. The server is scoped to `(language, root)`, so
// unrelated projects of the same language never share state.
export async function connectLanguage(
  languageId: string,
  filePath: string,
  root: string | null,
): Promise<Extension[]> {
  const rootUri = rootUriFor(root, filePath);
  const uri = pathToUri(filePath);

  // Open the single `lsp-message` channel before the server can emit anything.
  await ensureLspListener();

  // Spawn the server first so `initialize` has something to talk to. The call
  // returns the `server_key` the rest of the session must use.
  const serverKey: string = await invoke("lsp_ensure_and_start", {
    languageId,
    root: root ?? "",
    filePath,
  });

  const client = await getOrConnectClient(serverKey, rootUri);

  const ctrlClick = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      console.debug("[LSP] ctrl/cmd+click at offset", pos);
      event.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      void gotoDefinitionAt(view);
      return true;
    },
  });

  const codeActionKeymap = keymap.of([
    { key: "Mod-.", run: (view) => lspCodeAction(view) },
    { key: "Shift-Alt-o", run: (view) => lspOrganizeImports(view) },
  ]);

  // F12 jumps to definition through our own `gotoDefinitionAt` (which scrolls
  // in-file and opens + scrolls for external files). The Ctrl/Cmd+click path is
  // handled by `ctrlClick` above. `lspClickable` adds the underline/pointer
  // affordance while the modifier is held.
  const defKeymap = keymap.of([
    { key: "F12", run: (view) => { void gotoDefinitionAt(view); return true; } },
  ]);
  return [client.plugin(uri, languageId), ctrlClick, codeActionKeymap, lspClickable(), defKeymap];
}

// Stop a language's servers (used on demand by settings/teardown if needed).
export async function stopLanguage(languageId: string): Promise<void> {
  const prefix = `${languageId}|`;
  const keys = [...activeServers].filter((k) => k.startsWith(prefix));
  for (const key of keys) {
    await invoke("lsp_stop", { serverKey: key });
    const promise = clients.get(key);
    clients.delete(key);
    activeServers.delete(key);
    messageHandlers.delete(key);
    if (promise) promise.then((c) => c.disconnect()).catch(() => {});
  }
}

export interface PeekResult {
  path: string;
  uri: string;
  languageId: string;
  targetRange: { start: { line: number; character: number }; end: { line: number; character: number } };
  lines: { text: string; lineNumber: number; isTarget: boolean }[];
}

interface DefLocation {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

// Normalize the loosely-typed `textDocument/definition` response (which may be a
// single Location, a Location[], or a LocationLink[]) into a uniform shape.
function normalizeDefinitions(res: any): DefLocation[] {
  if (!res) return [];
  const arr = Array.isArray(res) ? res : [res];
  return arr
    .filter(Boolean)
    .map((r: any): DefLocation | null => {
      if (r.targetUri) {
        return { uri: r.targetUri, range: r.targetSelectionRange ?? r.targetRange };
      }
      if (r.uri) {
        return { uri: r.uri, range: r.range };
      }
      return null;
    })
    .filter((r): r is DefLocation => r !== null);
}

function rangeToOffset(doc: Text, range: DefLocation["range"]): { from: number; to: number } {
  const startLine = Math.min(Math.max(1, range.start.line + 1), doc.lines);
  const endLine = Math.min(Math.max(1, range.end.line + 1), doc.lines);
  const startLineObj = doc.line(startLine);
  const endLineObj = doc.line(endLine);
  const from = Math.min(startLineObj.from + range.start.character, startLineObj.to);
  const to = Math.min(endLineObj.from + range.end.character, endLineObj.to);
  return { from, to: Math.max(to, from) };
}

// Ask the language server for the definition at the view's current cursor. Shares
// the request plumbing between "go to" and "peek".
//
// We try `textDocument/definition` first, then fall back to `declaration` and
// `typeDefinition`. Servers vary in which they implement (and some return an
// empty result for one but not another), so the fallbacks make Ctrl+click /
// F12 resilient across languages instead of silently doing nothing.
async function requestDefinition(view: EditorView): Promise<DefLocation[]> {
  if (!lspMod) return [];
  const plugin = lspMod.LSPPlugin.get(view);
  if (!plugin) {
    notify("Language server not ready", "error");
    return [];
  }
  const client = plugin.client;
  const currentUri = plugin.uri;
  const pos = view.state.selection.main.head;
  // The library requires pending edits to be flushed to the server before a
  // manual request (its internal hover/completion paths do this automatically).
  try {
    client.sync();
  } catch {
    // Sync is best-effort; never let it block the definition request.
  }
  const position = plugin.toPosition(pos);
  const params = { textDocument: { uri: currentUri }, position };
  for (const method of [
    "textDocument/definition",
    "textDocument/declaration",
    "textDocument/typeDefinition",
  ]) {
    try {
      const result = await client.request<any, any>(method, params);
      const locs = normalizeDefinitions(result);
      if (locs.length) {
        console.debug(`[LSP] ${method} ->`, locs.length, "location(s)");
        return locs;
      }
      console.debug(`[LSP] ${method} returned no locations`);
    } catch (e: any) {
      console.error(`[LSP] ${method} failed:`, e);
    }
  }
  return [];
}

// Go to definition: if it lands in the current file, scroll to it (no new tab);
// otherwise open the target file and scroll to the definition there (reusing an
// existing tab for that file when one is already open).
export async function gotoDefinitionAt(view: EditorView): Promise<void> {
  // Mark a background operation so the status-bar spinner shows during the
  // whole navigation (LSP request + file open / scroll). Counter-based, so the
  // file's own LSP setup composes without flicker.
  useLoaderStore.getState().start();
  try {
    const locs = await requestDefinition(view);
    if (locs.length === 0) return;
    const loc = locs[0];
    if (!loc.range) {
      console.debug("[LSP] definition has no range; skipping navigation");
      return;
    }
    const currentUri = lspMod?.LSPPlugin.get(view)?.uri;
    const sameFile = currentUri ? pathsEqual(uriToPath(loc.uri), uriToPath(currentUri)) : false;
    if (sameFile) {
      const { from, to } = rangeToOffset(view.state.doc, loc.range);
      centerOnRange(view, from, to);
    } else {
      openFileInApp(uriToPath(loc.uri), undefined, {
        lineNumber: loc.range.start.line + 1,
        matchStart: loc.range.start.character,
        matchEnd: loc.range.end.character,
      });
    }
  } finally {
    useLoaderStore.getState().stop();
  }
}

// Peek definition: returns the target file's path, the definition range, and a
// window of its source lines (with the target lines marked) for an inline
// preview. Returns null when there's nothing to show.
export async function peekDefinition(view: EditorView): Promise<PeekResult | null> {
  const locs = await requestDefinition(view);
  if (locs.length === 0) return null;
  const loc = locs[0];
  const targetPath = uriToPath(loc.uri);
  const languageId = languageIdFromPath(targetPath) ?? "";

  const currentUri = lspMod?.LSPPlugin.get(view)?.uri;
  const sameFile = currentUri ? pathsEqual(targetPath, uriToPath(currentUri)) : false;
  let text: string;
  if (sameFile) {
    text = view.state.doc.toString();
  } else {
    try {
      text = await system.readFileContent(targetPath);
    } catch {
      notify(`Cannot read ${targetPath}`, "error");
      return null;
    }
  }

  const allLines = text.split("\n");
  const pad = 12;
  const targetStart = loc.range.start.line;
  const targetEnd = loc.range.end.line;
  const startIdx = Math.max(0, targetStart - pad);
  const endIdx = Math.min(allLines.length - 1, targetEnd + pad);
  const lines: PeekResult["lines"] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    lines.push({
      text: allLines[i] ?? "",
      lineNumber: i + 1,
      isTarget: i >= targetStart && i <= targetEnd,
    });
  }
  return { path: targetPath, uri: loc.uri, languageId, targetRange: loc.range, lines };
}

export function lspGoToDefinition(view: EditorView): boolean {
  void gotoDefinitionAt(view);
  return true;
}

export function lspRenameSymbol(view: EditorView): boolean {
  return lspMod?.renameSymbol(view) ?? false;
}

export function lspFindReferences(view: EditorView): boolean {
  return lspMod?.findReferences(view) ?? false;
}

export function lspFormatDocument(view: EditorView): boolean {
  return lspMod?.formatDocument(view) ?? false;
}

export function lspCodeAction(view: EditorView): boolean {
  const plugin = lspMod?.LSPPlugin.get(view);
  if (!plugin) return false;
  void runCodeActions(view, plugin.client, plugin);
  return true;
}

export function lspOrganizeImports(view: EditorView): boolean {
  const plugin = lspMod?.LSPPlugin.get(view);
  if (!plugin) return false;
  void runCodeActions(view, plugin.client, plugin, ["source.organizeImports"]);
  return true;
}

// HMR hygiene: when Vite hot-reloads this module during development, close any
// live LSP clients and remove the single global `lsp-message` listener so they
// don't pile up across reloads. The server process itself keeps running; the next
// session re-opens documents cleanly (see AuroraWorkspace.openFile).
const hot = (import.meta as any).hot;
if (hot) {
    hot.dispose(() => {
    globalLspListener?.();
    globalLspListener = null;
    for (const pending of clients.values()) {
      pending.then((c) => c.disconnect()).catch(() => {});
    }
    clients.clear();
    activeServers.clear();
    messageHandlers.clear();
    lspMod = null;
  });
}
