//! `aurora-lsp` — language server process lifecycle only.
//!
//! This crate depends on `aurora-core` and nothing else. It does not touch
//! Tauri, the network, or the filesystem for downloads. Its single job is to
//! spawn already-on-disk server binaries, pipe JSON-RPC over their stdio using
//! the LSP `Content-Length` framing, and manage their lifetime.
//!
//! Decoded messages coming back from a server are pushed onto an
//! `UnboundedSender<LspIncoming>` supplied at construction. The Tauri layer
//! (in `aurora-commands`) listens on that channel and re-emits each message as
//! a `lsp-message-{server_key}` event to the frontend.
//!
//! ## Lifetime model
//!
//! * **One server per `(language_id, project_root)`** — not per file, not per
//!   tab. A single `rust-analyzer` handles every `.rs` file opened in that
//!   project via `textDocument/didOpen`/`didClose`. The map is therefore keyed
//!   by a `server_key` string of the form `"{language_id}|{root}"`.
//! * **Lazy activation** — a server is only spawned when a file of that
//!   language is actually opened.
//! * **Narrow roots** — for languages with a manifest (`Cargo.toml`, `go.mod`,
//!   `tsconfig.json`, …) the root is narrowed to the nearest ancestor that
//!   contains it, so a server never indexes an entire monorepo.
//! * **Tiered idle eviction** — light servers are kept alive longer; heavy
//!   servers (rust-analyzer, clangd, jdtls, …) have a shorter idle timeout and
//!   a concurrent cap with LRU eviction.
//! * **Crash handling** — a dead server is restarted a bounded number of times
//!   with backoff, then dropped and the frontend falls back to Lezer linting.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use aurora_core::{AppError, ServerRuntime, ServerWeight};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc::UnboundedSender;

/// How many heavy servers may be alive at once. Opening a >Nth heavy language
/// evicts the least-recently-used heavy one first.
const MAX_HEAVY_SERVERS: usize = 3;
/// Max restart attempts after a crash before giving up and falling back.
const MAX_RESTARTS: u32 = 2;
/// A server is only auto-restarted if it was used within this window before it
/// died (so a server that crashed while idle is simply dropped).
const RESTART_WINDOW: Duration = Duration::from_secs(300);
/// Idle timeout for light servers.
const LIGHT_IDLE: Duration = Duration::from_secs(600);
/// Idle timeout for heavy servers.
const HEAVY_IDLE: Duration = Duration::from_secs(180);
/// Node `--max-old-space-size` for heavy Node-backed servers (MB).
const NODE_MEM_MB: u32 = 768;
/// JVM `-Xmx` for JVM-backed servers (MB), applied via `JAVA_TOOL_OPTIONS`.
const JVM_MEM_MB: u32 = 512;

/// A decoded JSON-RPC message received from a language server.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LspIncoming {
    pub language_id: String,
    /// The owning server's key (`"{language_id}|{root}"`). The frontend routes
    /// messages to the right client by this key (it is NOT used in the Tauri
    /// event name — server keys contain `|` and path separators, which are
    /// invalid in event names — so every message travels over one `lsp-message`
    /// channel and is dispatched in the frontend by `server_key`).
    pub server_key: String,
    pub message: String,
    /// Set when the server has exited and will not be revived, so the frontend
    /// can drop the client and fall back to Lezer linting.
    pub closed: bool,
}

/// One running language server process.
struct RunningServer {
    child: Child,
    stdin: Option<ChildStdin>,
    last_used: Instant,
    crashes: u32,
    weight: ServerWeight,
    runtime: ServerRuntime,
    /// Everything needed to relaunch the process after a crash.
    program: PathBuf,
    args: Vec<String>,
    root: PathBuf,
    language_id: String,
    server_key: String,
}

/// Parameters for spawning a language server.
pub struct LspStartParams {
    pub server_key: String,
    pub language_id: String,
    pub exec: PathBuf,
    pub args: Vec<String>,
    pub root: PathBuf,
    pub weight: ServerWeight,
    pub runtime: ServerRuntime,
}

/// Manages the set of running language servers, keyed by `server_key`.
pub struct LspManager {
    /// All running servers, keyed by `server_key`. Guarded by its own async mutex
    /// (not the whole `LspManager`) so a slow `send`/spawn never blocks unrelated
    /// servers. The lock is released during the (potentially slow) process spawn,
    /// keeping server startups parallel.
    servers: tokio::sync::Mutex<std::collections::HashMap<String, RunningServer>>,
    tx: UnboundedSender<LspIncoming>,
}

impl LspManager {
    /// Create a manager that forwards decoded server messages to `tx`.
    pub fn new(tx: UnboundedSender<LspIncoming>) -> Self {
        Self {
            servers: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            tx,
        }
    }

    /// Start a server if it is not already running. `exec` must already be
    /// resolved on disk (acquisition is handled by `aurora-lsp-fetch`).
    ///
    /// `server_key` is `"{language_id}|{root}"`. Heavy servers are subject to
    /// the concurrent cap: if too many heavy servers are alive, the
    /// least-recently-used one is evicted first.
    ///
    /// The process spawn happens *without* holding the servers lock, so concurrent
    /// `start` calls for different servers run their spawns in parallel instead of
    /// serializing on a single global lock. A per-key re-check on re-acquire
    /// prevents a duplicate (concurrent) spawn from leaking a process.
    pub async fn start(&self, params: LspStartParams) -> Result<(), AppError> {
        let LspStartParams {
            server_key,
            language_id,
            exec,
            args,
            root,
            weight,
            runtime,
        } = params;

        // Fast path: already running — no lock needed beyond the brief check.
        if self.servers.lock().await.contains_key(&server_key) {
            return Ok(());
        }

        // Enforce the concurrent heavy-server cap with LRU eviction *before*
        // spawning a fourth heavy server. Held only briefly.
        if weight == ServerWeight::Heavy {
            let do_evict = self
                .servers
                .lock()
                .await
                .values()
                .filter(|s| s.weight == ServerWeight::Heavy)
                .count()
                >= MAX_HEAVY_SERVERS;
            if do_evict {
                self.evict_lru_heavy().await;
            }
        }

        // Spawn the process OUTSIDE the lock so other servers can start in parallel.
        let program = exec;
        let (child, stdin, stdout) =
            launch(&program, &args, &root, weight, runtime).await?;

        // Re-acquire and insert. If a concurrent `start` for this exact key already
        // won, kill our freshly-spawned duplicate rather than leak it.
        let mut servers = self.servers.lock().await;
        if servers.contains_key(&server_key) {
            let mut duplicate = child;
            let _ = duplicate.start_kill();
            return Ok(());
        }

        let tx = self.tx.clone();
        let lang = language_id.clone();
        let key = server_key.clone();
        tokio::spawn(read_loop(stdout, lang, key, tx));

        let log_key = server_key.clone();
        servers.insert(
            server_key.clone(),
            RunningServer {
                child,
                stdin: Some(stdin),
                last_used: Instant::now(),
                crashes: 0,
                weight,
                runtime,
                program,
                args,
                root,
                language_id,
                server_key,
            },
        );
        drop(servers);

        tracing::info!("LSP server started: {}", log_key);
        Ok(())
    }

    /// Send a raw JSON-RPC message (without headers) to the running server.
    pub async fn send(&self, server_key: &str, message: String) -> Result<(), AppError> {
        let mut servers = self.servers.lock().await;
        let server = servers
            .get_mut(server_key)
            .ok_or_else(|| AppError::Lsp(format!("server not running: {}", server_key)))?;
        server.last_used = Instant::now();
        if let Some(stdin) = server.stdin.as_mut() {
            write_message(stdin, &message).await?;
        }
        Ok(())
    }

    /// Stop a running server, killing its process.
    pub async fn stop(&self, server_key: &str) -> Result<(), AppError> {
        if let Some(mut server) = self.servers.lock().await.remove(server_key) {
            let _ = server.child.kill().await;
            tracing::info!("LSP server stopped: {}", server_key);
        }
        Ok(())
    }

    /// Stop every running server, killing its process. Used on application
    /// shutdown so language-server processes don't linger and leak memory.
    pub async fn stop_all(&self) {
        let servers = std::mem::take(&mut *self.servers.lock().await);
        for (key, mut server) in servers {
            tokio::spawn(async move {
                let _ = server.child.kill().await;
            });
            tracing::info!("LSP server stopped on shutdown: {}", key);
        }
    }

    /// Evict the least-recently-used heavy server.
    async fn evict_lru_heavy(&self) {
        let victim = {
            let servers = self.servers.lock().await;
            servers
                .iter()
                .filter(|(_, s)| s.weight == ServerWeight::Heavy)
                .min_by_key(|(_, s)| s.last_used)
                .map(|(k, _)| k.clone())
        };
        if let Some(key) = victim {
            let (lang, skey) = {
                let servers = self.servers.lock().await;
                let srv = match servers.get(&key) {
                    Some(s) => s,
                    None => return,
                };
                (srv.language_id.clone(), srv.server_key.clone())
            };
            self.kill_and_notify(&key, &lang, &skey).await;
        }
    }

    /// Periodic maintenance: detect crashed servers (restart with backoff,
    /// bounded), then evict idle servers using a weight-aware timeout.
    pub async fn tick(&self) {
        let now = Instant::now();

        // --- Crash detection + bounded restart ---
        let mut restart: Vec<String> = Vec::new();
        let mut remove: Vec<(String, String, String)> = Vec::new();
        {
            let mut servers = self.servers.lock().await;
            for (key, srv) in servers.iter_mut() {
                match srv.child.try_wait() {
                    Ok(Some(_)) | Err(_) => {
                        let recent = now.duration_since(srv.last_used) < RESTART_WINDOW;
                        if srv.crashes < MAX_RESTARTS && recent {
                            restart.push(key.clone());
                        } else {
                            remove.push((
                                key.clone(),
                                srv.language_id.clone(),
                                srv.server_key.clone(),
                            ));
                        }
                    }
                    Ok(None) => {}
                }
            }
        }
        for key in &restart {
            self.relaunch(key).await;
        }
        for (key, lang, skey) in remove {
            self.kill_and_notify(&key, &lang, &skey).await;
        }

        // --- Idle eviction (weight-aware) ---
        let now = Instant::now();
        let idle: Vec<(String, String, String)> = {
            let servers = self.servers.lock().await;
            servers
                .iter()
                .filter_map(|(key, srv)| {
                    let timeout = if srv.weight == ServerWeight::Heavy {
                        HEAVY_IDLE
                    } else {
                        LIGHT_IDLE
                    };
                    if now.duration_since(srv.last_used) > timeout {
                        Some((
                            key.clone(),
                            srv.language_id.clone(),
                            srv.server_key.clone(),
                        ))
                    } else {
                        None
                    }
                })
                .collect()
        };
        for (key, lang, skey) in idle {
            self.kill_and_notify(&key, &lang, &skey).await;
        }
    }

    /// Re-launch a crashed server, applying exponential backoff. On failure the
    /// server is left in place (crashes already incremented) so the next tick
    /// retries, up to `MAX_RESTARTS`.
    async fn relaunch(&self, key: &str) {
        let (program, args, root, weight, runtime, backoff) = {
            let mut servers = self.servers.lock().await;
            let srv = match servers.get_mut(key) {
                Some(s) => s,
                None => return,
            };
            srv.crashes += 1;
            let backoff = Duration::from_secs(1u64 << srv.crashes.saturating_sub(1));
            (
                srv.program.clone(),
                srv.args.clone(),
                srv.root.clone(),
                srv.weight,
                srv.runtime,
                backoff,
            )
        };
        tokio::time::sleep(backoff).await;
        match launch(&program, &args, &root, weight, runtime).await {
            Ok((child, stdin, stdout)) => {
                let mut servers = self.servers.lock().await;
                match servers.get_mut(key) {
                    Some(srv) => {
                        srv.child = child;
                        srv.stdin = Some(stdin);
                        srv.last_used = Instant::now();
                        let tx = self.tx.clone();
                        let lang = srv.language_id.clone();
                        let keyc = key.to_string();
                        tokio::spawn(read_loop(stdout, lang, keyc, tx));
                        tracing::info!("LSP server restarted (attempt {}): {}", srv.crashes, key);
                    }
                    None => {
                        // Server was removed while we were relaunching; kill the orphan.
                        let mut orphan = child;
                        let _ = orphan.start_kill();
                    }
                }
            }
            Err(e) => {
                tracing::error!("LSP restart failed for {}: {}", key, e);
            }
        }
    }

    /// Kill a server and notify the frontend so it can fall back to Lezer.
    async fn kill_and_notify(&self, key: &str, language_id: &str, server_key: &str) {
        if let Some(mut srv) = self.servers.lock().await.remove(key) {
            tokio::spawn(async move {
                let _ = srv.child.kill().await;
            });
            tracing::info!("LSP server removed: {}", key);
            let _ = self.tx.send(LspIncoming {
                language_id: language_id.to_string(),
                server_key: server_key.to_string(),
                message: String::new(),
                closed: true,
            });
        }
    }

    /// Whether a server for `server_key` is currently running.
    pub async fn is_running(&self, server_key: &str) -> bool {
        self.servers.lock().await.contains_key(server_key)
    }
}

    /// Spawn the server process, applying runtime-specific memory caps.
    async fn launch(
        program: &Path,
        args: &[String],
        root: &Path,
        weight: ServerWeight,
        runtime: ServerRuntime,
    ) -> Result<(Child, ChildStdin, tokio::process::ChildStdout), AppError> {
    let mut cmd = Command::new(program);
    cmd.current_dir(root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    // Memory caps. For Node, the flag must precede the script on the command
    // line, so it is inserted before the (server) args. For the JVM we use
    // `JAVA_TOOL_OPTIONS`, which is read automatically by `java`.
    if runtime == ServerRuntime::Node && weight == ServerWeight::Heavy {
        cmd.arg(format!("--max-old-space-size={}", NODE_MEM_MB));
    }
    if runtime == ServerRuntime::Jvm {
        cmd.env(
            "JAVA_TOOL_OPTIONS",
            format!("-Xmx{}m", JVM_MEM_MB),
        );
    }

    cmd.args(args);

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW — do not pop a console for the server.
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Lsp(format!("failed to spawn {}: {}", program.display(), e)))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Lsp("server had no stdin".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Lsp("server had no stdout".to_string()))?;

    Ok((child, stdin, stdout))
}

/// Write a single LSP message framed with its `Content-Length` header.
async fn write_message(stdin: &mut ChildStdin, message: &str) -> Result<(), AppError> {
    let header = format!("Content-Length: {}\r\n\r\n", message.len());
    stdin
        .write_all(header.as_bytes())
        .await
        .map_err(|e| AppError::Lsp(format!("failed to write header: {}", e)))?;
    stdin
        .write_all(message.as_bytes())
        .await
        .map_err(|e| AppError::Lsp(format!("failed to write body: {}", e)))?;
    stdin
        .flush()
        .await
        .map_err(|e| AppError::Lsp(format!("failed to flush: {}", e)))?;
    Ok(())
}

/// Continuously read framed messages from a server's stdout and forward each
/// decoded JSON string to the channel, tagged with its `server_key`.
async fn read_loop(
    mut stdout: tokio::process::ChildStdout,
    language_id: String,
    server_key: String,
    tx: UnboundedSender<LspIncoming>,
) {
    let mut reader = BufReader::new(&mut stdout);
    loop {
        // Read headers until an empty line.
        let mut content_length: Option<usize> = None;
        let mut header_buf = String::new();
        loop {
            let mut line = Vec::new();
            match read_until_crlf(&mut reader, &mut line).await {
                Ok(0) => return, // EOF
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!("LSP read error ({}): {}", server_key, e);
                    return;
                }
            }
            // Strip trailing \r\n / \n.
            let trimmed = line
                .iter()
                .copied()
                .take_while(|&b| b != b'\n' && b != b'\r')
                .collect::<Vec<_>>();
            if trimmed.is_empty() {
                break; // end of headers
            }
            header_buf.push_str(&String::from_utf8_lossy(&trimmed));
            // Parse `Content-Length: N`.
            if let Some(rest) = header_buf.to_ascii_lowercase().strip_prefix("content-length:") {
                if let Ok(n) = rest.trim().parse::<usize>() {
                    content_length = Some(n);
                }
            }
            header_buf.clear();
        }

        let len = match content_length {
            Some(n) => n,
            None => {
                tracing::warn!("LSP framed message without Content-Length ({})", server_key);
                return;
            }
        };

        let mut body = vec![0u8; len];
        if let Err(e) = reader.read_exact(&mut body).await {
            tracing::warn!("LSP body read error ({}): {}", server_key, e);
            return;
        }

        let message = String::from_utf8_lossy(&body).to_string();
        if tx
            .send(LspIncoming {
                language_id: language_id.clone(),
                server_key: server_key.clone(),
                message,
                closed: false,
            })
            .is_err()
        {
            return; // receiver dropped
        }
    }
}

/// Read bytes up to and including a `\n`, appending the consumed bytes (including
/// the newline) into `out`. Returns the number of bytes read.
async fn read_until_crlf<R: AsyncReadExt + Unpin>(
    reader: &mut R,
    out: &mut Vec<u8>,
) -> std::io::Result<usize> {
    let mut total = 0;
    loop {
        let mut byte = [0u8; 1];
        let n = reader.read(&mut byte).await?;
        if n == 0 {
            return Ok(total);
        }
        out.push(byte[0]);
        total += 1;
        if byte[0] == b'\n' {
            return Ok(total);
        }
    }
}

/// Narrow the workspace root for `language_id` to the nearest manifest
/// directory above `file` (e.g. the `Cargo.toml` owning a `.rs` file), so a
/// server never indexes an entire monorepo. Falls back to `root` when no
/// manifest is found or `file` is empty.
pub fn narrow_root(language_id: &str, root: &Path, file: &Path) -> PathBuf {
    let manifests: &[&str] = match language_id {
        "rust" => &["Cargo.toml"],
        "go" => &["go.mod"],
        "typescript" | "javascript" => &["tsconfig.json", "jsconfig.json", "package.json"],
        "python" => &["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
        "java" => &["pom.xml", "build.gradle", "build.gradle.kts"],
        "kotlin" => &["build.gradle.kts", "settings.gradle", "pom.xml"],
        "scala" => &["build.sbt", "build.gradle"],
        "clojure" => &["deps.edn", "project.clj", "build.boot"],
        "ruby" => &["Gemfile", ".ruby-version"],
        "php" => &["composer.json"],
        "c" | "cpp" => &["compile_commands.json", ".clangd", "CMakeLists.txt", "Makefile"],
        "csharp" => &[], // handled via extension check below
        _ => return root.to_path_buf(),
    };

    let starts_with = |name: &str, m: &str| -> bool {
        if language_id == "csharp" {
            name.ends_with(".sln") || name.ends_with(".csproj")
        } else {
            name == m
        }
    };

    if file.as_os_str().is_empty() {
        return root.to_path_buf();
    }

    // If the file isn't under the project root at all, don't walk past `root`
    // up to the filesystem root — just use the project root as-is.
    if !file.starts_with(root) {
        return root.to_path_buf();
    }

    for ancestor in file.ancestors() {
        if let Some(name) = ancestor.file_name().and_then(|n| n.to_str()) {
            if manifests.iter().any(|m| starts_with(name, m)) {
                return ancestor.to_path_buf();
            }
        }
        // Don't walk above the supplied project root.
        if ancestor == root {
            break;
        }
    }
    root.to_path_buf()
}
