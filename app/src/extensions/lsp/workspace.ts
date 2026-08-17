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
    if (!this.opened.has(uri)) {
      this.opened.add(uri);
      // Clear any stale server-side document left by a previous client session
      // (e.g. after a dev-server reload / HMR). The library's `close()` never
      // sends `exit`/`shutdown`, so the language server still has these URIs
      // open; re-opening them makes it reject with "already open document".
      // Sending `didClose` first makes re-opening idempotent.
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

  // The base implementation re-sends `didOpen` for every open file once the
  // client finishes initializing. We already send `didOpen` from `openFile`
  // when an editor is created, so re-opening here would duplicate the request
  // and the server would reject it ("already open"), killing the pipe.
  connected(): void {}

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
