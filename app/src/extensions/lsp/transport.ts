import type { Transport } from "@codemirror/lsp-client";
import { invoke } from "@tauri-apps/api/core";
import {
  ensureLspListener,
  registerLspHandler,
  unregisterLspHandler,
} from "./client";

// Bridges a CodeMirror LSP `Transport` to the Rust LSP manager over Tauri IPC.
// Outgoing messages are forwarded with `lsp_send`; the Rust side frames them
// with Content-Length headers and writes to the server's stdin. Incoming server
// messages arrive over a single `lsp-message` channel (the frontend cannot use a
// per-server channel because `server_key` contains `|` and path separators,
// which are illegal in Tauri event names) and are routed to this transport's
// handler by `server_key`.
//
// `didChange` is debounced (~250ms) so heavier servers (rust-analyzer,
// tsserver, clangd) don't redo expensive analysis on every keystroke. Sync is
// full-document, so coalescing to the latest version is safe.
export function tauriTransport(serverKey: string): Transport {
  let currentHandler: ((value: string) => void) | null = null;
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const flush = (message: string) => {
    void invoke("lsp_send", { serverKey, message });
  };

  return {
    send(message: string) {
      const isChange = /"method"\s*:\s*"textDocument\/didChange"/.test(message);
      if (!isChange) {
        flush(message);
        return;
      }
      const uriMatch = /"uri"\s*:\s*"([^"]+)"/.exec(message);
      const key = uriMatch ? uriMatch[1] : "";
      const existing = debounceTimers.get(key);
      if (existing) clearTimeout(existing);
      debounceTimers.set(
        key,
        setTimeout(() => {
          debounceTimers.delete(key);
          flush(message);
        }, 250),
      );
    },
    subscribe(handler: (value: string) => void) {
      ensureLspListener();
      currentHandler = handler;
      registerLspHandler(serverKey, handler);
    },
    unsubscribe() {
      for (const t of debounceTimers.values()) clearTimeout(t);
      debounceTimers.clear();
      if (currentHandler) unregisterLspHandler(serverKey, currentHandler);
      currentHandler = null;
    },
  };
}
