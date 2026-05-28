# ADR 0008: Recover from ConPTY deadlocks by restarting the session

- Status: accepted
- Date: 2026-05-28

## Context

The Windows PTY layer can enter a deadlocked state under heavy session activity or resize/event pressure. When that happens, the terminal can stop responding even though the rest of the application is still healthy.

## Decision

Use session restart as the temporary recovery mechanism when a ConPTY deadlock is detected or strongly suspected.

## Consequences

- The app can restore terminal responsiveness without requiring a full application restart.
- A restarted session may lose in-flight shell state, so the mitigation favors recovery over perfect continuity.
- Deadlock handling stays operationally simple while a deeper fix is investigated.
- This ADR should be revisited if a more precise ConPTY recovery strategy becomes available.
