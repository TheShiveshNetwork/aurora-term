# Architecture Decision Records

This directory stores the project-level architecture decisions for Aurora.

## Conventions

- Use numbered, kebab-case filenames: `0001-short-title.md`.
- Keep one decision per file.
- Prefer short records with the same structure: Context, Decision, Consequences.
- Mark each record with a clear status such as `accepted`, `proposed`, or `superseded`.
- When a decision changes, add a new record instead of rewriting the old one.

## Current Records

- [0001 - Split the app into a Rust backend and React frontend](0001-split-the-app-into-a-rust-backend-and-react-frontend.md)
- [0002 - Centralize Tauri IPC behind typed frontend wrappers](0002-centralize-tauri-ipc-behind-typed-frontend-wrappers.md)
- [0003 - Render terminal output as session blocks in React](0003-render-terminal-output-as-session-blocks-in-react.md)
- [0004 - Integrate AI providers directly in Rust](0004-integrate-ai-providers-directly-in-rust.md)
- [0005 - Keep one PTY session per tab](0005-keep-one-pty-session-per-tab.md)
- [0006 - Split the Rust backend into crates](0006-split-the-rust-backend-into-crates.md)
- [0007 - Use pnpm workspaces for frontend packages](0007-use-pnpm-workspaces-for-frontend-packages.md)
- [0008 - Recover from ConPTY deadlocks by restarting the session](0008-recover-from-conpty-deadlocks-by-restarting-the-session.md)

