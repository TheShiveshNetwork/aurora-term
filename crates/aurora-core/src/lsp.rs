//! Shared LSP enums used by both `aurora-lsp` (lifecycle) and
//! `aurora-lsp-fetch` (acquisition) without creating a cross-crate dependency
//! between them.

/// Rough memory weight class of a language server. Drives idle-eviction timing
/// and the concurrent-heavy-server cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerWeight {
    /// Cheap servers (json/css/html/yaml/bash/toml/…). Kept alive longer, low
    /// eviction pressure.
    Light,
    /// Expensive servers (rust-analyzer, clangd, jdtls, metals, …) that can sit
    /// at hundreds of MB to 1GB+ on a real codebase.
    Heavy,
}

/// The runtime a server executes on. Used to apply process-level memory caps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerRuntime {
    /// Native binary (rust-analyzer, clangd, gopls, …). No flag-based cap; the
    /// heavy-server cap in `aurora-lsp` is what protects memory here.
    Native,
    /// Node.js-backed server. Capped via `--max-old-space-size`.
    Node,
    /// JVM-backed server. Capped via `JAVA_TOOL_OPTIONS=-Xmx…`.
    Jvm,
}
