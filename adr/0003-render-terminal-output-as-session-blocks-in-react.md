# ADR 0003: Render terminal output as session blocks in React

- Status: accepted
- Date: 2026-05-28

## Context

The terminal experience needs clean command grouping, output replay, bookmarks, AI annotations, and custom selection behavior. A raw terminal stream alone does not provide those product-level affordances.

## Decision

Treat each command as a block in application state, render those blocks in React, and keep the xterm surface focused on input and terminal protocol handling.

## Consequences

- Command output can be styled, grouped, replayed, and annotated independently of the shell buffer.
- UI features such as block headers, bookmarks, and AI explanations can be built without rewriting terminal plumbing.
- The app keeps a stronger separation between shell execution and presentation.
- This adds state management complexity, so block lifecycle handling must stay precise.
