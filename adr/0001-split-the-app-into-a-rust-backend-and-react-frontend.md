# ADR 0001: Split the app into a Rust backend and React frontend

- Status: accepted
- Date: 2026-05-28

## Context

Aurora needs native process control, PTY access, secure secret storage, and fast UI iteration. Those concerns do not belong in one runtime.

## Decision

Use Tauri as the application shell, with Rust owning system-facing work and React + TypeScript owning the web UI.

## Consequences

- Rust can manage PTYs, filesystem access, config, history, and AI network calls with native performance.
- React can evolve the interface independently without changing the system integration layer.
- The boundary between UI state and OS state stays explicit through IPC.
- This split keeps the application small compared with a full Electron-style desktop stack.
