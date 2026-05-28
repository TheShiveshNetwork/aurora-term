# ADR 0002: Centralize Tauri IPC behind typed frontend wrappers

- Status: accepted
- Date: 2026-05-28

## Context

The frontend talks to many backend commands: PTY control, config, history, process management, filesystem queries, and AI actions. Scattered `invoke()` calls would make that surface hard to audit and easy to misuse.

## Decision

Keep all frontend IPC calls in a single module and expose domain-specific wrappers from there.

## Consequences

- Command names, payload shapes, and return types stay easy to find in one place.
- The UI imports `pty`, `ai`, `history`, `config`, `process`, and `system` helpers instead of calling `invoke()` directly.
- Backend command changes are easier to track because the integration surface is centralized.
- Adding new commands stays mechanical: define the Rust command, then add one wrapper entry.
