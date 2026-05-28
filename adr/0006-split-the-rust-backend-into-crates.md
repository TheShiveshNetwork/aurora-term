# ADR 0006: Split the Rust backend into crates

- Status: accepted
- Date: 2026-05-28

## Context

Aurora has several backend concerns that change at different rates: PTY/session handling, AI provider adapters, command registration, configuration loading, data persistence, and sidecar management. Keeping all of that in one Rust crate would increase coupling and make ownership unclear.

## Decision

Organize the Rust backend as a Cargo workspace with focused crates for core types, PTY handling, persistence, configuration, sidecar support, AI integration, and command orchestration.

## Consequences

- Each backend concern can evolve with a smaller API surface.
- The application binary depends on composition, not one large monolith.
- Shared types live in a smaller core crate, which reduces circular dependencies.
- Reusing backend capabilities in future tools or binaries becomes more practical.
