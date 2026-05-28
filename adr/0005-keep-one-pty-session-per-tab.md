# ADR 0005: Keep one PTY session per tab

- Status: accepted
- Date: 2026-05-28

## Context

Aurora is designed around isolated terminal tabs with independent working directories, history, and execution state. Shared PTY state would make tab switching and replay behavior ambiguous.

## Decision

Create and manage a separate PTY session for each terminal tab.

## Consequences

- Tabs can preserve their own cwd, shell state, and running command lifecycle.
- Switching tabs does not require rebuilding terminal state from a shared backend process.
- The UI can track per-tab execution blocks and alternate-buffer transitions more reliably.
- Resource usage is higher than a single shared shell, so session cleanup must remain strict.
