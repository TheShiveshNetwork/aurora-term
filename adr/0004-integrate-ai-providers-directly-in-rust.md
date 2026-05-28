# ADR 0004: Integrate AI providers directly in Rust

- Status: accepted
- Date: 2026-05-28

## Context

Aurora supports multiple AI providers with different APIs, streaming formats, and key storage requirements. The app also needs a uniform way to stream responses back into the UI.

## Decision

Implement AI provider adapters directly in the Rust backend behind a shared provider trait, and store API keys in the OS keychain.

## Consequences

- The backend owns request construction, SSE parsing, retries, and provider-specific quirks.
- The frontend receives one streamed event shape regardless of provider.
- Adding a provider means implementing the shared trait rather than building a separate execution path.
- Key material stays in platform key storage instead of local files or frontend state.
