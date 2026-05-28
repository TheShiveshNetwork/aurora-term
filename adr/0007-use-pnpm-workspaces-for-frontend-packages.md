# ADR 0007: Use pnpm workspaces for frontend packages

- Status: accepted
- Date: 2026-05-28

## Context

Aurora already has more than one JavaScript/TypeScript package boundary: the main app and shared package space such as `packages/types`. The frontend needs a package manager setup that can scale without duplicating dependencies or losing the ability to share code cleanly.

## Decision

Use pnpm workspaces for the frontend and shared packages, with the app package as the primary consumer and the root scripts delegating into the app workspace.

## Consequences

- Shared packages can be linked locally without publishing overhead.
- Dependency installation stays consistent across app and package workspaces.
- Workspace-level scripts can target the app while still leaving room for additional packages later.
- The repo can grow into a multi-package frontend without changing its dependency model.
