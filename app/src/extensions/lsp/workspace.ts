import { Workspace, LSPPlugin, type WorkspaceFile } from "@codemirror/lsp-client";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openFileInApp } from "../../lib/openFileRef";
import { uriToPath } from "./languageId";

class AuroraWorkspaceFile implements WorkspaceFile {
  uri: string;
  languageId: string;
  version: number;
  doc: Text;
  private view: EditorView | null;

  constructor(uri: string, languageId: string, version: number, doc: Text, view: EditorView | null) {
    this.uri = uri;
    this.languageId = languageId;
    this.version = version;
    this.doc = doc;
    this.view = view;
  }

  getView(): EditorView | null {
    return this.view;
  }

  setView(view: EditorView | null): void {
    this.view = view;
  }
}

export class AuroraWorkspace extends Workspace {
  files: AuroraWorkspaceFile[] = [];
  private fileVersions: Record<string, number> = Object.create(null);
  private pending = new Map<string, (view: EditorView | null) => void>();
  // Tracks URIs for which we've actually sent `didOpen`, so we never send a
  // duplicate `textDocument/didOpen` (the server rejects those).
  private opened = new Set<string>();
  // Whether the client has finished the `initialize` handshake. `didOpen` must
  // NOT be sent before this — servers ignore/drop documents opened prior to
  // `initialized`, which would leave hover/definition returning nothing even
  // though the LSP extension is loaded.
  private initialized = false;

  private nextFileVersion(uri: string): number {
    return (this.fileVersions[uri] = (this.fileVersions[uri] ?? -1) + 1);
  }

  syncFiles() {
    const result: { file: AuroraWorkspaceFile; changes: any; prevDoc: Text }[] = [];
    for (const file of this.files) {
      const view = file.getView();
      if (!view) continue;
      const plugin = LSPPlugin.get(view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        result.push({ file, changes, prevDoc: file.doc });
        file.doc = view.state.doc;
        file.version = this.nextFileVersion(file.uri);
        plugin.clear();
      }
    }
    return result;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const existing = this.files.find((f) => f.uri === uri);
    if (existing) {
      existing.setView(view);
      return;
    }
    const newFile = new AuroraWorkspaceFile(uri, languageId, this.nextFileVersion(uri), view.state.doc, view);
    this.files.push(newFile);
    // Defer `didOpen` until the server has finished `initialize` (handled in
    // `connected()`). If the server is already initialized, open it now. The
    // `didClose`-first guard keeps re-opening idempotent across HMR / reconnects
    // where the server may still hold the document open.
    if (this.initialized && !this.opened.has(uri)) {
      this.opened.add(uri);
      this.client.didClose(uri);
      this.client.didOpen(newFile);
    }
    const resolve = this.pending.get(uri);
    if (resolve) {
      this.pending.delete(uri);
      this.waitForContent(view, () => resolve(view));
    }
  }

  closeFile(uri: string, _view: EditorView): void {
    this.files = this.files.filter((f) => f.uri !== uri);
    if (this.opened.has(uri)) {
      this.opened.delete(uri);
      this.client.didClose(uri);
    }
  }

  // Called by the plugin once the client has completed the `initialize` handshake
  // and the server is ready to receive document notifications. Open every file
  // we've registered so far (they were deferred from `openFile` until now). The
  // `didClose`-first guard makes this safe when reconnecting to a server that
  // still holds the document open (HMR / client restart).
  connected(): void {
    this.initialized = true;
    for (const file of this.files) {
      if (this.opened.has(file.uri)) continue;
      this.opened.add(file.uri);
      this.client.didClose(file.uri);
      this.client.didOpen(file);
    }
  }

  displayFile(uri: string): Promise<EditorView | null> {
    const existing = this.getFile(uri);
    if (existing && existing.getView()) {
      return Promise.resolve(existing.getView());
    }
    const open = openFileInApp;
    if (!open) return Promise.resolve(null);
    open(uriToPath(uri), undefined);
    return new Promise<EditorView | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 8000);
      this.pending.set(uri, (view) => {
        clearTimeout(timer);
        resolve(view);
      });
    });
  }

  private waitForContent(view: EditorView, cb: () => void): void {
    try {
      if (view.state.doc.length > 0) {
        cb();
        return;
      }
    } catch {
      cb();
      return;
    }
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      let loaded = false;
      try {
        loaded = view.state.doc.length > 0;
      } catch {
        loaded = true;
      }
      if (loaded || tries > 40) {
        clearInterval(iv);
        cb();
      }
    }, 50);
  }
}
