# AGENT.md — aurora-term

> Source of truth for all agents and contributors. Read fully before writing any code.
> Never deviate from patterns here without updating this file first.

---

## 1. Project Identity

| Field | Value |
|---|---|
| Name | `Aurora` |
| Description | Hardware-accelerated, AI-native developer terminal. GPU-rendered blocks, multi-provider AI routing. |
| Architecture | Tauri v2 (Rust) + React + TypeScript (WebView) |
| Target OS | Windows, macOS, Linux |
| Rust edition | 2021 |
| Node | ≥ 20.19 |
| Package manager | `pnpm` (never npm or yarn) |

---

## 2. Repository Layout

```
aurora-term/
├── AGENT.md
├── Cargo.toml                        ← Rust workspace root (members: crates/*, tauri/)
├── Cargo.lock
├── package.json                      ← root pnpm scripts that delegate into `app`
├── pnpm-workspace.yaml               ← packages: ['app', 'packages/*']
├── pnpm-lock.yaml
├── tsconfig.json
├── .env.example
├── adr/                              ← Architecture Decision Records (adr/)
├── static/                           ← static assets (screenshots, images)
│
├── scripts/
│   ├── dev.ps1
│   ├── build.ps1
│   └── size-audit.ps1
│
├── app/                              ← Vite/React frontend for Tauri (top-level web app)
│   ├── package.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── components/
        ├── hooks/
        ├── stores/
        ├── lib/
        └── styles/
│
├── crates/                           ← Rust workspace crates (pure logic; no Tauri deps)
│   ├── aurora-core/
│   ├── aurora-pty/
│   ├── aurora-db/
│   ├── aurora-config/
│   ├── aurora-sidecar/
│   ├── aurora-ai/
│   └── aurora-commands/
│
├── tauri/                            ← Tauri binary harness (invokes `aurora-app` crate)
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   └── src/main.rs
│
└── packages/                         ← shared TS packages used by `app`
    ├── types/                        ← @aurora/types (shared type definitions)
    ├── tsconfig/                     ← @aurora/tsconfig
    └── eslint-config/                ← @aurora/eslint-config
```

## ADR Specification and Requirements

- Location: `adr/` at repository root. Commit ADRs into git.
- Filename convention: `NNNN-short-title.md` (four-digit numeric prefix to allow many records).
- Required fields inside each ADR:
  - `Status:` (accepted | proposed | superseded)
  - `Date:` (YYYY-MM-DD)
  - `Context` — why this decision matters now
  - `Decision` — the chosen option, concise
  - `Consequences` — positive and negative effects, follow-ups
- Style: Prefer one decision per ADR; keep them short (1–2 screens). When an ADR changes, create a new ADR that references the previous one.

## Routing Guidance (How to ask the agent to place logic)

To route new logic, use a concise instruction such as:

"Route `<feature>` to `crates/<crate-name>`: short reason and required public interfaces."

Example: "Route terminal resize debounce and ConPTY watchdog to `crates/aurora-pty`: needs `PtyManager::watch_deadlocks()` and an IPC command `pty_restart(session_id)`." 

Below is a short crate summary to help route logic quickly.

| Crate | Short description |
|---|---|
| `aurora-core` | Shared types, errors, and config schema (no I/O). |
| `aurora-pty` | PTY lifecycle, sessions, readers, and platform quirks. |
| `aurora-db` | SQLite history storage and fuzzy search helpers. |
| `aurora-config` | Three-tier persistence: JSON config manager (global + project merge), UI state manager, OS keychain helpers. |
| `aurora-sidecar` | Manages the local aurora-agent sidecar process lifecycle. |
| `aurora-ai` | AI provider adapters, SSE parsing, and router logic. |
| `aurora-commands` | Thin orchestration layer that maps tauri commands to crate APIs. |


---

## 3. Crate Responsibilities & What to Write Where

### `crates/aurora-core`
Pure library. Zero Tauri, zero I/O, zero async. Everything else depends on this.
- `error.rs` — `AppError` enum with `thiserror` + `serde::Serialize`. One variant per domain (Pty, Ai, Db, Config, Io). All other crates convert their errors into `AppError`.
- `config.rs` — `AppConfig` struct, fully `serde` + `serde_json`. Nested structs for `terminal`, `ai`, `keybindings`, `appearance`, `editor`. No file I/O here — only the schema.
- `types/block.rs` — `Block`, `BlockStatus`, `OutputType`.
- `types/session.rs` — `PaneType`, `EditorSession`, `TermSession`.
- `types/ai.rs` — `TaskTier`, `ProviderName`, `AiMessage`. No provider logic.

### `crates/aurora-pty`
Depends on `aurora-core`. No Tauri.
- `manager.rs` — `PtyManager` holds a `HashMap<session_id, PtySession>`. Methods: `spawn`, `kill`, `resize`. Spawning starts the reader loop and takes a `tokio::sync::mpsc::Sender` for PTY output — the Tauri layer subscribes to this channel and emits events.
- `session.rs` — `PtySession` wraps `portable_pty` master/child. Reader loop runs in `tokio::task::spawn_blocking` (PTY reads are blocking). Reads in 4096-byte chunks. Emits on channel; does not touch Tauri directly.
- `shell.rs` — detect default shell per OS using `which`. Build default `HashMap<String,String>` env. Never hardcode paths.

### `crates/aurora-db`
Depends on `aurora-core`. No Tauri.
- `db.rs` — `HistoryDb::new(path)` opens/creates SQLite, runs migrations on startup. Schema: `command_history`, `snippets`, `sessions`. Path always comes from the caller (Tauri layer) via `app.path().app_data_dir()` — never resolved here.
- `search.rs` — `fuzzy_search(query, limit)` using `nucleo`. Returns `Vec<HistoryEntry>`.
- `migrations/001_initial.sql` — DDL only. Track schema version in a `schema_version` table. Run in `HistoryDb::new`.

### `crates/aurora-config`
Depends on `aurora-core`. No Tauri.
- `manager.rs` — `ConfigManager`. Two-tier JSON persistence: `load_merged()` deep-merges global + project overrides via `serde_json::Value`, `save_global()`/`save_project()` write to respective files. Auto-backup (`<file>.bak`) before every write. Legacy `config.toml` → `aurora.json` migration on first load. `new()` takes `PathBuf` (never `&impl Manager`). Uses `serde_json` for runtime, keeps `toml` only for migration path.
- `state.rs` — `UiStateManager` + `UiState`. Separate `state.json` for transient UI state: sidebar collapse, tab bar visibility, section visibility, pinned tabs, tab list, last project dir, last workspace CWD. Loaded on startup, saved via debounced IPC commands. Never overlaps with settings in `aurora.json`.
- `keychain.rs` — thin wrappers over `keyring` crate. `set_key(service, account, secret)`, `get_key`, `delete_key`. Service name is always `"aurora-term"`. Account names are `"{provider}_api_key"`.

### `crates/aurora-sidecar`
Depends on `aurora-core`. No Tauri.
- `manager.rs` — `SidecarManager`: spawn the aurora-agent sidecar process, track its `Child`, expose `port()` after health check. Kill on drop. Spawns `pnpm dev --port <port>` in dev builds if a workspace root is present, and runs the native compiled standalone executable (`aurora-agent-<target-triple>`) next to the main app executable in release/production.
- `monitor.rs` — poll child exit status on a background task. Send on a `oneshot` or `watch` channel so the Tauri layer can emit an `agent_crashed` event.

### `crates/aurora-app`
Depends on all other crates + `tauri`. This is the only crate that touches Tauri APIs.
- `lib.rs` — exports `pub fn run()`. Builds the Tauri app: registers plugins, calls `.manage(AppState{...})`, registers all `#[tauri::command]` handlers via `invoke_handler!`.
- `state.rs` — `AppState { pty_manager: Arc<Mutex<PtyManager>>, history_db: Arc<Mutex<HistoryDb>>, config_manager: Arc<Mutex<ConfigManager>>, ui_state: Arc<Mutex<UiStateManager>>, sidecar: Arc<Mutex<SidecarManager>>, ai_router: Arc<AiRouter> }`. Always `tokio::sync::Mutex`, never `std::sync::Mutex`.
- `commands/*.rs` — each file owns one domain. Every command returns `Result<T, AppError>`. No business logic — delegate entirely to the relevant crate. Commands are thin IPC adapters.
- `ai/providers/mod.rs` — `AiProvider` trait (see Section 7). Router calls through the trait; commands never call a provider directly.

### `tauri/`
No runtime logic whatsoever. Four build and config responsibilities only:
1. `main.rs` — `fn main() { aurora_app::run(); }`
2. `tauri.conf.json` — `frontendDist: "../desktop/dist"`, `devUrl: "http://localhost:5173"`. Configured to package `binaries/aurora-agent` in the `bundle.externalBin` array.
3. `capabilities/default.json` — grant only what the app uses. Read https://v2.tauri.app/security/capabilities/ before adding any permission.
4. `build.rs` — automatically compiles `packages/aurora-agent/src/index.ts` to `tauri/binaries/aurora-agent-<target-triple>` using Bun's compiler on Cargo build.

---

## 4. Pinned Versions

### Frontend (pnpm)

| Package | Version |
|---|---|
| `react` / `react-dom` | `^19.2` |
| `typescript` | `^6.0` |
| `vite` | `^8.0` |
| `@vitejs/plugin-react` | `^4.x` |
| `tailwindcss` + `@tailwindcss/vite` | `^4.3` |
| `@xterm/xterm` | `^5.x` |
| `@xterm/addon-fit/webgl/web-links/search` | match xterm major |
| `zustand` | `^5.x` |
| `@tauri-apps/api` | `^2.x` — must match `tauri` crate minor |
| `codemirror` + `@codemirror/*` | `^6.x` |
| `lucide-react` | `latest` |
| `vitest` | `^4.x` |

### Rust (Cargo)

| Crate | Version |
|---|---|
| `tauri` | `^2` — keep synced with `@tauri-apps/api` minor |
| `tauri-build` | `^2` |
| `tokio` | `^1` (features = ["full"]) |
| `serde` + `serde_json` | `^1` |
| `reqwest` | `^0.12` (features = ["json", "stream"]) |
| `portable-pty` | `^0.8` |
| `rusqlite` | `^0.31` (features = ["bundled"]) |
| `uuid` | `^1` (features = ["v4", "serde"]) |
| `toml` | `^0.8` |
| `thiserror` | `^2` |
| `anyhow` | `^1` (only in `main.rs`) |
| `tracing` + `tracing-subscriber` | `^0.1` / `^0.3` |
| `nucleo` | `^0.5` |
| `chrono` | `^0.4` (features = ["serde"]) |
| `async-trait` | `^0.1` |
| `keyring` | `^3` |

> After any `pnpm update`, verify `@tauri-apps/api` npm minor matches `tauri` Cargo minor. Mismatch = runtime failure.

---

## 5. IPC Contract

All types in `desktop/src/types/ipc.ts` must mirror Rust structs exactly (field names, types).

**Events — Rust → Frontend**
```typescript
PtyDataEvent    = { session_id: string; data: string }
PtyExitEvent    = { session_id: string; exit_code: number }
AIStreamChunk   = { request_id: string; chunk: string; done: boolean }
```

**Commands — Frontend → Rust** (all live in `desktop/src/lib/ipc.ts`, the only file that calls `invoke()`)
```typescript
// PTY
pty_spawn(shell, env)           → string (session_id)
pty_write(session_id, data)     → void
pty_resize(session_id, cols, rows) → void
pty_kill(session_id)            → void

// AI
ai_stream_completion(request_id, messages) → void   // streams via events
ai_translate_command(query, context)       → string
ai_explain_error(command, output, exit_code) → string
ai_save_api_key(provider, key)             → void
ai_delete_api_key(provider)               → void
ai_test_provider(provider)                → boolean
ai_set_provider(provider)                 → void

// History
history_search(query, limit)    → HistoryEntry[]
history_add(entry)              → void

// Config — two-tier JSON (global + project level overrides, deep-merged)
config_get()                    → AppConfig (deep-merged global + project)
config_get_global()             → AppConfig (global only)
config_get_project()            → AppConfig (project overrides only, empty if no project file)
config_save_global(cfg)         → void
config_save_project(cfg)        → void
config_has_project()            → boolean

// UI State — separate state.json for transient UI (never overlaps with aurora.json)
state_get()                     → UiState
state_update_sidebar(collapsed) → void
state_update_pinned_tabs(tabs)  → void
state_update_section_visibility(visibility) → void
state_update_tabs(tabs)         → void
state_set_project_dir(path)     → void
state_set_workspace_cwd(cwd)    → void

// Sidecar (controlled internally on startup)
```

---

## 6. State Management

One Zustand store per domain. No async inside stores. Async logic lives in hooks; hooks call `ipc.ts` then update stores.

| Store | Owns |
|---|---|
| `useSessionStore` | tabs, active session ID, pane layout |
| `useBlockStore` | `Map<session_id, Block[]>` — metadata only, not raw output |
| `useAIStore` | provider config, pending requests, streaming state |
| `useAgentStore` | agent runs, tool calls, results |
| `useSettingsStore` | theme, keybinding mode, font — mode stored here so StatusBar reads it |
| `useProcessStore` | background PIDs, forwarded ports |

Never store raw terminal output in React state. xterm.js owns the buffer. `useBlockStore` stores finalized block metadata only: `command`, `exit_code`, `duration_ms`, `output_type`, `status`.

---

## 7. AI Architecture

### Task Tiers

| Tier | Use For | Max Output |
|---|---|---|
| `Fast` | Autocomplete, inline fix | 200 tokens |
| `Balanced` | NL→command, short error explain | 800 tokens |
| `Powerful` | Deep diagnosis, workflow generation | 3000 tokens |

### Provider → Model Mapping (defaults, all overridable in config)

| Provider | Fast | Balanced | Powerful |
|---|---|---|---|
| Anthropic | `claude-haiku-4-5-20251015` | `claude-sonnet-4-6-20260217` | `claude-opus-4-7-20260416` |
| OpenAI | `gpt-5-mini` | `gpt-5.4-mini` | `gpt-5.5` |
| Gemini | `gemini-3.1-flash-lite` | `gemini-3.5-flash` | `gemini-3.1-pro` |
| NVIDIA NIM | `meta/llama-3.1-8b-instruct` | `meta/llama-4-scout-17b-16e-instruct` | `meta/llama-3.1-405b-instruct` |
| Ollama | `llama3.2:3b` | `llama3.1:8b` | `llama3.1:70b` |

Model IDs are read from `AppConfig`, never hardcoded in Rust source. Users can override any tier.

### AiProvider Trait
```rust
#[async_trait]
pub trait AiProvider: Send + Sync {
    fn model_for_tier(&self, tier: TaskTier) -> &str;
    async fn stream_completion(
        &self,
        messages: Vec<AiMessage>,
        tier: TaskTier,
        window: tauri::Window,
        request_id: String,
    ) -> Result<(), AppError>;
}
```

### Provider Notes
- **OpenAI + NVIDIA NIM**: same `/v1/chat/completions` schema. Implement once in `openai.rs`, pass `base_url` as constructor param.
- **Gemini**: different shape. Endpoint: `POST /v1beta/models/{model}:streamGenerateContent?alt=sse`. Body uses `contents` + `systemInstruction`, not `messages`. Auth via `x-goog-api-key` header.
- **Ollama**: `POST /api/chat`. Stream is newline-delimited JSON (not SSE). No auth. Check liveness via `GET /api/tags` before requests; emit `ollama_not_running` event if refused.

### API Key Security
Keys are stored in OS keychain only — never in `config.toml`, never logged, never sent to frontend. Frontend only receives `hasApiKey: boolean`.
```rust
// write
keyring::Entry::new("aurora-term", "anthropic_api_key")?.set_password(&key)?;
// read
let key = keyring::Entry::new("aurora-term", "anthropic_api_key")?.get_password()?;
```

---

## 8. Tailwind v4 Rules

- **No `tailwind.config.ts`**. Configuration is CSS-first in `desktop/src/styles/globals.css` via `@theme {}`.
- **No PostCSS, no autoprefixer**. Tailwind v4 uses Lightning CSS internally.
- Vite plugin: `import tailwindcss from '@tailwindcss/vite'` added to `plugins: []`.
- Theme switching: set `data-theme` attribute on `<html>`. Override variables in `[data-theme="light"] {}`.
- xterm.js `ITheme` must be built by reading CSS variables at runtime — never duplicate color values.

---

## 9. Rust Patterns

**AppState** — always `tokio::sync::Mutex`, never `std::sync::Mutex`. Register via `.manage()`. Clone only `Arc` handles, never the whole state.

**Commands** — every `#[tauri::command]` returns `Result<T, AppError>`. No blocking I/O; use `tokio::task::spawn_blocking` when needed. Commands are adapters only — all logic is in the crate being called.

**Errors** — `AppError` is the single error type across all crates. Implement `From<E>` for each crate's error type into `AppError`. `AppError` must derive `serde::Serialize` so Tauri serializes it to the frontend.

**Logging** — `tracing::info!` / `tracing::error!` everywhere. Never `println!`.

**IDs** — `uuid::Uuid::new_v4().to_string()` for all generated IDs.

**PTY reader** — runs in `spawn_blocking`. Reads 4096-byte chunks. Batch-emits if multiple chunks arrive within 16ms to avoid flooding the frontend.

---

## 10. Binary Size — Hard Limit: 15 MB (NSIS installer)

Release profile in `tauri/Cargo.toml`:
```toml
[profile.release]
opt-level     = "z"
lto           = true
codegen-units = 1
panic         = "abort"
strip         = true
```

Only enable Tauri features you actually use — no `features = ["all"]` on any crate.

Frontend: lazy-load xterm via `manualChunks`. Named imports only from `lucide-react`. Run `cargo bloat --release --crates` and `npx vite-bundle-visualizer` before every release.

---

## 11. Database Schema

```sql
CREATE TABLE command_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    command     TEXT    NOT NULL,
    cwd         TEXT    NOT NULL,
    exit_code   INTEGER,
    duration_ms INTEGER,
    created_at  INTEGER NOT NULL
);
CREATE TABLE snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    command TEXT NOT NULL,
    description TEXT,
    tags TEXT,        -- JSON array
    created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
    id         TEXT    PRIMARY KEY,
    name       TEXT,
    shell      TEXT    NOT NULL,
    cwd        TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    last_used  INTEGER NOT NULL
);
```

DB path resolved by the Tauri layer via `app.path().app_data_dir()` — never hardcoded in `aurora-db`.

---

## 12. Hard Rules

**Never:**
- `unwrap()` or `expect()` in production paths — use `?` with `AppError`
- Store API keys in `aurora.json`, `state.json`, `localStorage`, or any log
- Send an API key to the frontend — only `hasApiKey: bool`
- Hardcode model strings in Rust — always read from `AppConfig`
- Call a provider struct directly from a command — always go through `AiRouter`
- Use `features = ["full"]` or `features = ["all"]` on any crate
- Call `invoke()` outside `desktop/src/lib/ipc.ts`
- Put async logic inside Zustand stores
- Hardcode paths — use Tauri's path API
- Create `tailwind.config.ts` or add `postcss`/`autoprefixer`
- Use the old unscoped `xterm` package — use `@xterm/xterm`
- Add Tauri APIs to any crate except `aurora-app`
- Mix UI state into `aurora.json` — use `state.json` for transient UI (sidebar, tabs, project-dir)
- Use TOML for config — use JSON (`aurora.json`), `toml` crate is only for legacy migration
- Add Tauri deps to `aurora-config` — `ConfigManager::new()` takes `PathBuf`, never `&impl Manager`
- Write config files without backup — always create `.bak` before overwriting

**Always:**
- Mirror every Rust IPC struct in `desktop/src/types/ipc.ts`
- Emit Tauri events with typed payload structs, not raw strings
- Keep `@tauri-apps/api` npm minor in sync with `tauri` Cargo minor
- Use `tracing` for all Rust logging
- Run `cargo clippy -- -D warnings` with zero warnings before any commit
- Check https://v2.tauri.app/develop/updating-dependencies/ before bumping Tauri deps

---

## 13. Build Commands

```bash
# Install all dependencies
pnpm install

# Dev (all)
pnpm dev

# Dev (desktop only — Tauri window)
pnpm dev:desktop

# Dev (web only — Next.js)
pnpm dev:web

# Production build
pnpm build:desktop
pnpm build:web

# Type check all workspaces
pnpm typecheck

# Rust tests
cargo test --workspace

# Rust lint (zero warnings)
cargo clippy --workspace -- -D warnings

# Size audit before release
./scripts/size-audit.ps1

# Add a dep to a specific workspace
pnpm add zustand --filter @aurora/desktop
pnpm add next-auth --filter @aurora/web
```

**Release checklist:**
1. Bump version in `desktop/package.json`, `tauri/Cargo.toml`, `tauri/tauri.conf.json` — all three together.
2. `cargo clippy --workspace -- -D warnings` → zero warnings.
3. `pnpm typecheck` → zero errors.
4. `./scripts/size-audit.ps1` → installer under 15 MB.
5. Verify `@tauri-apps/api` minor matches `tauri` Cargo minor.
6. Test PTY spawn/kill on each target OS.

---

## 14. Testing the Built App with tauri-mcp

To perform automated visual and DOM tests on the built Tauri application using `tauri-mcp`:

1. **Enable WebView2 Remote Debugging**:
   Before launching the built executable, set the following environment variable to expose WebView2's CDP interface:
   ```powershell
   # PowerShell
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
   ```
   ```bash
   # Bash
   export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
   ```

2. **Launch the Built App**:
   Run the compiled executable (e.g. `src-tauri/target/release/aurora-term.exe` or `pnpm tauri dev`).

3. **Configure & Invoke tauri-mcp**:
   Use the `tauri-mcp` tools to inspect the app state and perform visual assertions:
   - `get_dom` — fetch the active HTML DOM structure of the WebView2 window.
   - `take_screenshot` — capture an image screenshot of the current viewport to verify rendering.
   - `click_selector` — trigger click events on elements.
   - `eval_js` — evaluate arbitrary JavaScript in the application's context.

---

## 15. New Coding & UI Patterns

### Tab-Based Agent Sandboxing
- All agent execution states, queues, logs, and chain nodes MUST be sandboxed per terminal session.
- The `useAgentStore` uses a `sessions` map keyed by `sessionId` (the tab ID).
- **Zustand Selector Performance Rule**: Any selector hook (such as `useAgentExecution`) query must fall back to a stable reference `CONST_DEFAULT_SESSION_STATE` rather than calling `defaultSessionState()`. Returning a new object reference on every selector run causes infinite React re-render loops on startup.

### Agent Overlay Chat UI & Layout
- The `AgentOverlay` is a right-side chatbot panel next to the terminal.
- Outer styling: matches the left side panel (`bg-background` and `border-l border-outline-variant/10`), resizable from the left edge (mouse drag listener, width bounded between `240px` and `600px`).
- Inner styling: the chatbot interface is wrapped inside an inner rounded card (`rounded-2xl` with `bg-surface-container-high/30` background).
- Symmetrical layout: the outer panel uses `px-0` (no horizontal padding), while all inner children (header, body, footer) use symmetrical `px-4` padding.
- Text selection: the outer panel wrapper uses `select-text` to allow selecting and copying AI messages, commands, or logs. Only the drag-resize handle uses `select-none` to prevent text selection during resizing.

### AI Slang Removal & Deterministic UI Slang
- Never include instructions or examples in the AI agent prompt (`aura.ts`) asking the AI to speak in Gen Z slang, as this leads to non-deterministic behaviors. Keep model prompts professional and deterministic.
- UI progress strings (like `"Farming..."`) and loaders are hardcoded directly in the frontend UI files for consistent, deterministic behavior.

---

## 16. projectDir vs currentDir Separation

The app maintains two distinct directory concepts:

### projectDir (trusted project root)
- **What**: The root directory the user explicitly opened via "Open Folder". This is the trusted boundary — commands outside this directory are not auto-accepted.
- **Storage**: Persisted in `state.json` as `last_project_dir` via `UiStateManager`. No longer part of `AppConfig` or `aurora.json`.
- **Display**: Shown on the **app header** (project name derived from `projectDirLabel`).
- **Set when**: User selects "Open Folder" → `useAppShellStore.setProjectDir(path)`.
- **Restored**: From config on bootstrap in `useAppBootstrap.ts`.

### currentDir (per-terminal working directory)
- **What**: The real-time working directory of each terminal session, tracked from the shell prompt sentinel (`__AURORA_CWD__=<path>`). Each terminal tab has its own independent currentDir.
- **Storage**: Runtime only — `useAppShellStore.sessionCwds[ sessionId ]`. Not persisted.
- **Display**: Shown on the **status bar** and inside the **terminal session** (via xterm.js).
- **Updated when**: User runs `cd` in any terminal → `cleanPtyData()` extracts `cwdValue` → `TerminalPane` dispatches `cwd-change` CustomEvent → `useAppBootstrap` handler updates `sessionCwds`.
- **Inherited**: New file view tabs inherit from the active terminal's currentDir.

### Key Rules
- **Terminals spawn in projectDir**, not the active terminal's currentDir.
- **File tree** (`SidePanel`) opens from projectDir, not the terminal's cwd.
- **`cwd-change` events never update projectDir** — only `sessionCwds`.
- **App header shows projectDir** — unaffected by terminal `cd`.
- **Status bar shows the active terminal's currentDir** (falls back to projectDir).
- **`noFolder`** = `tabs.length === 0` (no terminal/file tabs open), but projectDir can be restored from `state.json` even when no tabs exist.

### Store Fields (`useAppShellStore`)
| Field | Type | Purpose |
|---|---|---|
| `projectDir` | `string` | Absolute path of the trusted project root |
| `projectDirLabel` | `string` | Display label (`~/folder-name`) derived from projectDir |
| `cwdAbsolute` | `string` | Active context directory (file ops, backward compat) |
| `cwd` | `string` | Display label for cwdAbsolute |
| `sessionCwds` | `Record<string, string>` | Per-terminal-session current directories |

---

## 17. Persistence Architecture — Three-Tier Storage

The app uses three separate storage layers, each with a distinct file, format, and change frequency:

| Tier | File | Format | Managed By | Change Frequency |
|---|---|---|---|---|
| **Settings** (preferences) | `aurora.json` | JSON | `ConfigManager` | Rare (explicit save button) |
| **UI State** (layout, tabs, project-dir) | `state.json` | JSON | `UiStateManager` | Frequent (auto-save, 1s debounce) |
| **Secrets** (API keys) | OS Keychain | — | `keyring` via `KeychainManager` | Rare (add/delete key) |

All paths are resolved by the Tauri layer (`app.path().app_data_dir()`) — never hardcoded in `aurora-config`.

### 17.1 Settings — Two-Tier Deep Merge

**Global config**: `~/.config/aurora/aurora.json` — the base layer containing all `AppConfig` fields.

**Project config**: `<projectRoot>/.aurora/aurora.json` — sparse overrides that deep-merge over global at individual field granularity using `serde_json::Value::merge()`. (Note: Specific workspace-level settings overrides are not yet implemented on the frontend/agent side. All settings changes are applied globally).

**Merge order**: Load global → if project file exists, deep-merge into global → deserialize merged `Value` into `AppConfig`.

**Save paths**: `config_save_global(cfg)` writes to global file. `config_save_project(cfg)` writes to project file (creates `.aurora/` dir if missing).

**Auto-backup**: Every write creates `<filename>.bak` of the previous content before overwriting.

**Legacy migration**: On first load, if `aurora.json` doesn't exist but `config.toml` does, read TOML → write JSON → delete TOML.

### 17.2 UI State — Transient Layout & Session Data

**Schema** (`UiState`): `last_project_dir`, `last_workspace_cwd`, `sidebar_collapsed`, `tab_bar_visible`, `section_visibility: HashMap<String, bool>`, `pinned_tabs: Vec<SavedTab>`, `tabs: Vec<SavedTab>`.

**Restore flow**: `useAppBootstrap` calls `state.get()` on mount → hydrates `useAppShellStore` (projectDir, sidebar, tab bar, section visibility) and `useSessionStore` (tab metadata).

**Save flow**: `usePersistUIState` subscribes to Zustand stores → 1s debounce → flushes via `state.*` IPC commands directly (no read-modify-write race).

### 17.3 Secrets — OS Keychain Only

```rust
keyring::Entry::new("aurora-term", "anthropic_api_key")?.set_password(&key)?;
```

Service name is always `"aurora-term"`. Account names follow `"{provider}_api_key"`. Frontend only receives `hasApiKey: bool` — never the key value.

### 17.4 IPC Command Map

All config IPC in `app/src/lib/ipc.ts` → `config.*`:
- `config.get()` — merged (global + project), `config.getGlobal()`, `config.getProject()`
- `config.saveGlobal(cfg)`, `config.saveProject(cfg)`
- `config.hasProject()` — whether project overrides file exists

All UI state IPC in `app/src/lib/ipc.ts` → `state.*`:
- `state.get()` — full `UiState`
- `state.setProjectDir(path)`, `state.setWorkspaceCwd(cwd)`
- `state.updateSidebar(collapsed)`, `state.updateTabs(tabs)`, `state.updatePinnedTabs(tabs)`, `state.updateSectionVisibility(visibility)`

### 17.5 Key Rules

- `aurora-config` crate never depends on Tauri — `ConfigManager::new()` and `UiStateManager::new()` take `PathBuf`, never `&impl tauri::Manager`.
- `state.json` is for transient UI only — never duplicate settings from `aurora.json`.
- `.bak` file created before every config write — never write in place.
- API keys never appear in any JSON file, logs, or frontend.
- `toml` crate is a dependency only for legacy migration — all runtime config is JSON.

---

*Last updated: 2026-06-29*