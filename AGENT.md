# AGENT.md — aurora-term

> This file is the source of truth for every agent or developer building this project.
> Read it fully before writing any code. Never deviate from the patterns defined here
> without updating this file first.

---

## 0. Required Reading — Documentation Links

**Before writing any code, read these docs. Not the cached versions in your training data — fetch them live.**

| Doc | URL | Why |
|---|---|---|
| Tauri v2 Getting Started | https://v2.tauri.app/start/ | Entry point for setup, prerequisites, project structure |
| Tauri v2 Prerequisites | https://v2.tauri.app/start/prerequisites/ | Exact toolchain requirements per OS |
| Tauri v2 Create Project | https://v2.tauri.app/start/create-project/ | Scaffold command, template selection |
| Tauri v2 Vite Frontend | https://v2.tauri.app/start/frontend/vite/ | Vite-specific Tauri config |
| Tauri v2 IPC — Calling Rust | https://v2.tauri.app/develop/calling-rust/ | `invoke()`, command registration, permissions |
| Tauri v2 IPC — Calling Frontend | https://v2.tauri.app/develop/calling-frontend/ | `window.emit()`, event listeners |
| Tauri v2 State Management | https://v2.tauri.app/develop/state-management/ | `manage()`, `State<T>`, AppState patterns |
| Tauri v2 App Size | https://v2.tauri.app/concept/size/ | Binary size reduction techniques — **mandatory** |
| Tauri v2 Security | https://v2.tauri.app/security/ | Capabilities, permissions, CSP |
| Tauri v2 Capabilities | https://v2.tauri.app/security/capabilities/ | How to grant shell/fs/path permissions |
| Tauri v2 Config Files | https://v2.tauri.app/develop/configuration-files/ | `tauri.conf.json` schema |
| Tauri v2 Updating Deps | https://v2.tauri.app/develop/updating-dependencies/ | Keep npm + Cargo versions in sync |
| Tailwind CSS v4 + Vite | https://tailwindcss.com/docs/installation/using-vite | v4 CSS-first config, `@tailwindcss/vite` plugin |
| Tailwind CSS v4 Overview | https://tailwindcss.com/docs/v4-beta | What changed from v3 — no `tailwind.config.js` by default |

**Critical version notes from docs:**
- Tauri v2 requires the `@tauri-apps/api` npm package and `tauri` Cargo crate to be on **the same minor version**. Check `https://v2.tauri.app/develop/updating-dependencies/` before adding any Tauri plugin.
- Tailwind v4 uses `@tailwindcss/vite` instead of PostCSS. No `tailwind.config.ts` by default — configuration is CSS-first via `@theme {}` blocks in your CSS.
- Do **not** rely on training data for Tauri API signatures. Always check the live docs above.

---

## 1. Project Identity

| Field | Value |
|---|---|
| Name | `aurora-term` |
| Description | A highly optimized, hardware-accelerated, and AI-native developer console featuring Neovim modal command interfaces, decoupled GPU terminal blocks, instant system error diagnostics, and a multi-provider semantic intelligence engine |
| Architecture | Tauri v2 (Rust backend) + React + TypeScript (WebView frontend) |
| Target OS | Windows (primary), macOS, Linux |
| Rust edition | 2021 |
| Node | ≥ 20.19 (required by Vite 8) |
| Package manager | `npm` (never pnpm or yarn unless explicitly migrated) |

---

## 2. Pinned Package Versions

**Always use these exact major versions. Do not downgrade. Check npm/crates.io for latest patch.**

### Frontend (npm)

| Package | Version | Notes |
|---|---|---|
| `react` | `^19.2` | Latest stable as of 2026 |
| `react-dom` | `^19.2` | Must match react version exactly |
| `typescript` | `^6.0` | Latest stable; 7.0 Beta exists but is not stable yet |
| `vite` | `^8.0` | Requires Node ≥ 20.19 or 22.12 |
| `@vitejs/plugin-react` | `^4.x` | Latest — check npmjs.com |
| `tailwindcss` | `^4.3` | CSS-first, no postcss by default |
| `@tailwindcss/vite` | `^4.3` | Required Vite plugin for Tailwind v4 |
| `@xterm/xterm` | `^5.x` | Do NOT use old `xterm` package |
| `@xterm/addon-fit` | `^0.10.x` | Must match xterm major |
| `@xterm/addon-web-links` | `^0.10.x` | Must match xterm major |
| `@xterm/addon-search` | `^0.10.x` | Must match xterm major |
| `zustand` | `^5.x` | Check for v5 API changes from v4 |
| `@tauri-apps/api` | `^2.x` | Must stay in sync with `tauri` Cargo crate minor |
| `lucide-react` | `latest` | |
| `vitest` | `^4.x` | |

### Rust (Cargo)

| Crate | Version | Notes |
|---|---|---|
| `tauri` | `^2` | Latest: 2.11.x — keep synced with `@tauri-apps/api` npm |
| `tauri-build` | `^2` | Must match tauri crate minor |
| `tokio` | `^1` | Full features |
| `serde` | `^1` | With `derive` |
| `serde_json` | `^1` | |
| `reqwest` | `^0.12` | Features: `json`, `stream` |
| `portable-pty` | `^0.8` | Cross-platform PTY |
| `rusqlite` | `^0.31` | Feature: `bundled` |
| `uuid` | `^1` | Features: `v4`, `serde` |
| `toml` | `^0.8` | |
| `thiserror` | `^2` | Error enums |
| `anyhow` | `^1` | `main.rs` only |
| `tracing` | `^0.1` | |
| `tracing-subscriber` | `^0.3` | |
| `nucleo` | `^0.5` | Fuzzy search |
| `chrono` | `^0.4` | Features: `serde` |
| `base64` | `^0.22` | |
| `which` | `^7` | |
| `once_cell` | `^1` | Prefer `std::sync::OnceLock` on Rust ≥ 1.70 |
| `async-trait` | `^0.1` | Required for `AiProvider` trait with async methods |
| `tauri-plugin-keyring` | `^2` | OS-native keychain storage for API keys |

> **Sync rule:** After any `npm update`, run `cargo update` and verify `@tauri-apps/api`
> and `tauri` crate minor versions still match. If they diverge, the build will fail at runtime.

---

## 3. Binary Size — Non-Negotiable Constraint

**The installed aurora-term binary must stay under 15 MB on Windows (NSIS installer).** This is a hard requirement, not a guideline. Tauri's advantage over Electron is precisely that it ships without bundling a browser — do not undo this.

Read https://v2.tauri.app/concept/size/ in full. Apply every technique listed there. The rules below are the minimum:

### Cargo.toml Release Profile

```toml
# src-tauri/Cargo.toml

[profile.release]
opt-level     = "z"      # optimize for size, not speed
lto           = true     # link-time optimization — removes dead code across crates
codegen-units = 1        # single codegen unit for maximum LTO effectiveness
panic         = "abort"  # removes panic unwinding machinery (~10-20% size reduction)
strip         = true     # strip debug symbols from binary
```

### Tauri Feature Gating

Only enable the Tauri features you actually use. Every enabled feature adds to binary size.

```toml
# BAD — enables everything
tauri = { version = "^2", features = ["all"] }

# GOOD — only what aurora-term needs
tauri = { version = "^2", features = [
  "shell-open",   # open URLs/files in system default app
  "path-all",     # resolve app data / config directories
] }
```

Check `https://v2.tauri.app/security/capabilities/` — only grant capabilities the app needs in `tauri.conf.json`.

### Frontend Bundle Size

```typescript
// vite.config.ts — production build config
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target:          'es2022',
    minify:          'esbuild',
    reportCompressedSize: false,  // skip gzip reporting — faster build
    rollupOptions: {
      output: {
        manualChunks: {
          // Lazy-load xterm only when a terminal pane is first opened
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links', '@xterm/addon-search'],
          // Lazy-load monaco only in workflow editor
          monaco: ['monaco-editor'],
        },
      },
    },
  },
})
```

- **Never import `monaco-editor` at the top level.** It is ~3 MB. Use `React.lazy()` + `import()`.
- **Never import all of `lucide-react`.** Named imports only: `import { Terminal } from 'lucide-react'`.
- Run `npx vite-bundle-visualizer` before every release to catch regressions.
- Tailwind v4 automatically purges unused CSS — never disable this.

### Size Audit Checklist (run before every release)

```powershell
# Check release binary size
ls src-tauri/target/release/aurora-term.exe

# Check installer size
ls src-tauri/target/release/bundle/nsis/

# Check frontend bundle size
npm run build -- --reportCompressedSize

# Analyze what's in the Rust binary
cargo bloat --release --crates -n 20
```

- If binary > 15 MB: check for accidental `features = ["full"]` on any crate, run `cargo tree` to find unexpected heavy transitive deps.
- If frontend bundle > 500 KB (gzipped): run `npx vite-bundle-visualizer` and identify the offender.

---

## 4. Repository Layout

```
aurora-term/
│
├── AGENT.md                         ← you are here
├── README.md
├── package.json                     ← frontend deps + tauri CLI scripts
├── vite.config.ts
├── tsconfig.json
├── .env.example                     ← never commit .env
│
├── src/                             ← React / TypeScript frontend
│   ├── main.tsx                     ← Vite entry, mounts <App />
│   ├── App.tsx                      ← root layout: TabBar + ActivePane
│   │
│   ├── components/
│   │   ├── terminal/
│   │   │   ├── TerminalPane.tsx     ← xterm.js wrapper, one per tab
│   │   │   ├── TerminalBlock.tsx    ← single command+output block
│   │   │   ├── BlockAIBar.tsx       ← per-block AI context panel
│   │   │   └── OutputRenderer.tsx  ← diff / JSON / plain switch
│   │   ├── ui/
│   │   │   ├── TabBar.tsx
│   │   │   ├── CommandPalette.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   ├── SidePanel.tsx        ← process manager, port manager
│   │   │   └── Toast.tsx
│   │   ├── ai/
│   │   │   ├── AICommandBar.tsx     ← natural language → command
│   │   │   └── InlineExplain.tsx   ← error explanation overlay
│   │   └── settings/
│   │       ├── SettingsModal.tsx
│   │       └── ThemeEditor.tsx
│   │
│   ├── stores/                      ← Zustand stores (one per domain)
│   │   ├── useSessionStore.ts       ← tabs, active pane, PTY session ids
│   │   ├── useBlockStore.ts         ← command blocks per session
│   │   ├── useAIStore.ts            ← AI state, pending requests, context
│   │   ├── useSettingsStore.ts      ← theme, keybindings, AI provider config
│   │   └── useProcessStore.ts      ← background processes, ports
│   │
│   ├── hooks/
│   │   ├── usePTY.ts                ← subscribe to pty-data Tauri events
│   │   ├── useKeybindings.ts        ← modal editing mode state machine
│   │   ├── useAICompletion.ts       ← streaming AI responses
│   │   └── useCommandHistory.ts    ← fuzzy search over SQLite history
│   │
│   ├── lib/
│   │   ├── ipc.ts                   ← typed wrappers around invoke() — ONLY place invoke() is called
│   │   ├── ansi.ts                  ← ANSI escape helpers
│   │   ├── parsers/
│   │   │   ├── jsonOutput.ts
│   │   │   ├── diffOutput.ts
│   │   │   └── detectOutputType.ts
│   │   └── keymaps/
│   │       ├── default.ts
│   │       └── vim.ts
│   │
│   ├── types/
│   │   ├── session.ts
│   │   ├── block.ts
│   │   ├── ai.ts
│   │   └── ipc.ts                   ← mirror of Rust IPC payload types
│   │
│   └── styles/
│       └── globals.css              ← @import "tailwindcss"; + @theme {} blocks
│
├── src-tauri/                       ← Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   │
│   └── src/
│       ├── main.rs                  ← Tauri builder, plugin registration
│       ├── lib.rs                   ← pub mod declarations
│       ├── error.rs                 ← unified AppError type
│       │
│       ├── pty/
│       │   ├── mod.rs
│       │   ├── manager.rs           ← PtyManager: spawn, kill, resize sessions
│       │   └── session.rs           ← PtySession struct, reader loop
│       │
│       ├── ai/
│       │   ├── mod.rs
│       │   ├── client.rs            ← reqwest HTTP client, streaming SSE
│       │   ├── providers/
│       │   │   ├── anthropic.rs
│       │   │   └── openai.rs
│       │   └── prompts.rs           ← system prompts as constants
│       │
│       ├── history/
│       │   ├── mod.rs
│       │   ├── db.rs                ← rusqlite setup, migrations
│       │   └── search.rs            ← nucleo fuzzy search over history
│       │
│       ├── config/
│       │   ├── mod.rs
│       │   ├── schema.rs            ← Config struct (serde + toml)
│       │   └── loader.rs            ← read/write config via Tauri path API
│       │
│       ├── commands/                ← ALL Tauri #[tauri::command] fns live here
│       │   ├── mod.rs               ← re-exports all commands for main.rs
│       │   ├── pty_commands.rs
│       │   ├── ai_commands.rs
│       │   ├── history_commands.rs
│       │   ├── config_commands.rs
│       │   └── process_commands.rs
│       │
│       └── state/
│           └── mod.rs               ← AppState struct (Arc-wrapped shared state)
│
└── scripts/
    ├── dev.ps1                      ← Windows dev helper
    ├── build.ps1
    └── size-audit.ps1               ← runs cargo bloat + bundle visualizer
```

---

## 5. Architecture: Layered Event-Driven Design

```
┌─────────────────────────────────────────────────────────────┐
│                     React Frontend (WebView)                 │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │ xterm.js   │  │ Zustand      │  │ React Components    │  │
│  │ (render)   │  │ (state)      │  │ (UI layer)          │  │
│  └─────┬──────┘  └──────┬───────┘  └──────────┬──────────┘  │
│        │                │                      │              │
│        └────────────────┴──────────────────────┘             │
│                         │  Tauri IPC (invoke / listen)        │
├─────────────────────────┼────────────────────────────────────┤
│                     Rust Backend                              │
│  ┌──────────────┐  ┌────┴──────────┐  ┌──────────────────┐  │
│  │  PtyManager  │  │ CommandRouter │  │  AppState (Arc)  │  │
│  │  (sessions)  │  │  (#[command]) │  │  (shared data)   │  │
│  └──────┬───────┘  └───────────────┘  └──────────────────┘  │
│         │                                                      │
│  ┌──────┴───────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │  AI Client   │  │  History DB   │  │  Config Loader   │  │
│  │  (reqwest)   │  │  (rusqlite)   │  │  (toml)          │  │
│  └──────────────┘  └───────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow: Command Execution

```
User types command (frontend)
  → useKeybindings detects Enter in NORMAL mode
  → ipc.ts: invoke("pty_write", { session_id, data })
  → Rust: pty_commands::pty_write writes to PTY master
  → OS executes command in child shell
  → PtySession reader loop reads output bytes
  → window.emit("pty_data", PtyDataPayload { session_id, data })
  → Frontend: usePTY hook receives event
  → TerminalBlock is finalized, output stored in useBlockStore
  → If exit code != 0: useAIStore.queueExplain(block_id)
```

### Data Flow: AI Natural Language Command

```
User presses Ctrl+K (opens AICommandBar)
  → User types natural language query
  → ipc.ts: invoke("ai_translate_command", { query, context })
  → Rust: ai_commands → ai::client → POST /v1/messages (streaming)
  → Rust emits "ai_stream_chunk" events token-by-token
  → Frontend: useAICompletion streams into AICommandBar
  → User confirms → command injected into active PTY session
```

---

## 6. Tailwind v4 Setup (not v3)

Tailwind v4 is a breaking change from v3. There is **no `tailwind.config.ts`** by default and **no PostCSS** required for Vite projects. Read https://tailwindcss.com/docs/installation/using-vite before touching CSS.

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),  // ← replaces PostCSS pipeline entirely
  ],
})
```

```css
/* src/styles/globals.css — entire Tailwind config lives here */
@import "tailwindcss";

@theme {
  --color-term-bg:       #0d0d0d;
  --color-term-fg:       #e8e8e8;
  --color-ui-surface:    #1a1a1a;
  --color-ui-border:     #2a2a2a;
  --color-ui-accent:     #f0c060;
  --color-ai-bar:        #161b22;
}
```

- Never create a `tailwind.config.js` or `tailwind.config.ts`. Use `@theme {}` in CSS.
- Never add `autoprefixer` or `postcss` to the project — Tailwind v4 uses Lightning CSS internally.
- Tailwind v4 has automatic content detection — no `content: []` array needed.

---

## 7. State Management Rules

**Use one Zustand store per domain. Never put cross-domain logic inside a store.**

| Store | Owns |
|---|---|
| `useSessionStore` | tabs, active session ID, pane layout, split state |
| `useBlockStore` | Map<session_id, Block[]>, current running block |
| `useAIStore` | AI provider config, pending requests, streaming state |
| `useSettingsStore` | theme tokens, keybinding map, font, AI API key (persisted to config) |
| `useProcessStore` | background PIDs, forwarded ports, docker context |

**Rules:**
- Stores are plain slices. No async logic inside stores.
- Async logic lives in hooks (`src/hooks/`). Hooks call `ipc.ts`, then update stores.
- Never call `invoke()` directly from a component. Always go through `src/lib/ipc.ts`.
- Never store raw terminal output in React state. xterm.js owns the buffer; `useBlockStore` stores finalized block metadata only (command, exit_code, duration_ms, output_summary).

---

## 8. IPC Contract

All Tauri IPC types must be mirrored in `src/types/ipc.ts` exactly matching the Rust structs.
Read https://v2.tauri.app/develop/calling-rust/ and https://v2.tauri.app/develop/calling-frontend/ before adding any new IPC surface.

### Events (Rust → Frontend via `window.emit`)

```typescript
// src/types/ipc.ts

export type PtyDataEvent = {
  session_id: string;
  data:        string; // raw bytes as UTF-8 string
};

export type PtyExitEvent = {
  session_id: string;
  exit_code:  number;
};

export type AIStreamChunkEvent = {
  request_id: string;
  chunk:       string;
  done:        boolean;
};

export type ProcessSpawnedEvent = {
  pid:        number;
  command:    string;
  session_id: string;
};
```

### Commands (Frontend → Rust via `invoke`)

```typescript
// src/lib/ipc.ts — ONLY place invoke() is called in the entire frontend

import { invoke } from '@tauri-apps/api/core';

export const pty = {
  spawn:  (shell: string, env: Record<string, string>) =>
    invoke<string>('pty_spawn', { shell, env }),

  write:  (session_id: string, data: string) =>
    invoke<void>('pty_write', { session_id, data }),

  resize: (session_id: string, cols: number, rows: number) =>
    invoke<void>('pty_resize', { session_id, cols, rows }),

  kill:   (session_id: string) =>
    invoke<void>('pty_kill', { session_id }),
};

export const ai = {
  translateCommand: (query: string, context: string) =>
    invoke<string>('ai_translate_command', { query, context }),

  explainError: (command: string, output: string, exit_code: number) =>
    invoke<string>('ai_explain_error', { command, output, exit_code }),

  streamCompletion: (request_id: string, messages: AIMessage[]) =>
    invoke<void>('ai_stream_completion', { request_id, messages }),
};

export const history = {
  search: (query: string, limit: number) =>
    invoke<HistoryEntry[]>('history_search', { query, limit }),

  add: (entry: Omit<HistoryEntry, 'id' | 'created_at'>) =>
    invoke<void>('history_add', { entry }),
};

export const config = {
  get: () => invoke<AppConfig>('config_get'),
  set: (config: Partial<AppConfig>) => invoke<void>('config_set', { config }),
};
```

---

## 9. Rust Backend Patterns

### AppState — Shared Mutable State

```rust
// src-tauri/src/state/mod.rs

use std::sync::Arc;
use tokio::sync::Mutex;
use crate::pty::manager::PtyManager;
use crate::history::db::HistoryDb;
use crate::config::schema::AppConfig;

pub struct AppState {
    pub pty_manager: Arc<Mutex<PtyManager>>,
    pub history_db:  Arc<Mutex<HistoryDb>>,
    pub config:      Arc<Mutex<AppConfig>>,
}
```

- **Always use `tokio::sync::Mutex`**, never `std::sync::Mutex`, in async Tauri commands.
- Wrap `AppState` in `tauri::State<AppState>`. Register it via `.manage()` in `main.rs`.
- Never clone entire state. Clone only the `Arc` handles you need.
- See https://v2.tauri.app/develop/state-management/ for the canonical Tauri v2 pattern.

### Command Pattern

Every `#[tauri::command]` follows this exact signature pattern:

```rust
// src-tauri/src/commands/pty_commands.rs

use tauri::{command, State, Window};
use crate::state::AppState;
use crate::error::AppError;

#[command]
pub async fn pty_spawn(
    window:  Window,
    state:   State<'_, AppState>,
    shell:   String,
    env:     std::collections::HashMap<String, String>,
) -> Result<String, AppError> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let mut manager = state.pty_manager.lock().await;
    manager.spawn(session_id.clone(), shell, env, window).await?;
    Ok(session_id)
}
```

**Rules:**
- Every command returns `Result<T, AppError>`. Never return raw `String` errors.
- `AppError` implements `serde::Serialize` so Tauri can send it to the frontend as a typed error.
- Never do blocking I/O in a command. Use `tokio::task::spawn_blocking` if you must.

### Unified Error Type

```rust
// src-tauri/src/error.rs

#[derive(Debug, thiserror::Error, serde::Serialize)]
pub enum AppError {
    #[error("PTY error: {0}")]    Pty(String),
    #[error("AI error: {0}")]     Ai(String),
    #[error("Database error: {0}")] Db(String),
    #[error("Config error: {0}")] Config(String),
    #[error("IO error: {0}")]     Io(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self { AppError::Io(e.to_string()) }
}
```

### PTY Session — Reader Loop

```rust
// src-tauri/src/pty/session.rs

pub async fn start_reader_loop(
    mut reader: Box<dyn Read + Send>,
    session_id: String,
    window:     Window,
) {
    // PTY reads are blocking — must run in spawn_blocking
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = window.emit("pty_exit", PtyExitPayload {
                        session_id: session_id.clone(),
                        exit_code: 0,
                    });
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = window.emit("pty_data", PtyDataPayload {
                        session_id: session_id.clone(),
                        data,
                    });
                }
            }
        }
    });
}
```

---

## 10. Frontend Patterns

### Component Rules

- No business logic in components. Components render state and dispatch events. All logic lives in hooks.
- No direct `invoke()` calls in components. Always use `src/lib/ipc.ts`.
- No inline styles. All styling via Tailwind utility classes + CSS variables defined in `globals.css`.
- Component files: PascalCase. Hook files: camelCase prefixed with `use`.

### Block-Based Output Model

```typescript
// src/types/block.ts

export type BlockStatus = 'running' | 'success' | 'error' | 'cancelled';
export type OutputType  = 'plain' | 'json' | 'diff' | 'image' | 'markdown';

export interface Block {
  id:           string;
  session_id:   string;
  command:      string;
  started_at:   number;
  finished_at?: number;
  exit_code?:   number;
  status:       BlockStatus;
  output_type:  OutputType;   // detected after first 512 bytes
  collapsed:    boolean;
  ai_explain?:  string;       // populated when AI explains an error
  bookmarked:   boolean;
}
```

`TerminalBlock.tsx` renders one block. `useBlockStore` owns all blocks. xterm.js renders live output during `running` state; finalized output is rendered by `OutputRenderer.tsx`.

### Modal Editing State Machine

Neovim-style modes are a finite state machine — implement it as such, not as ad-hoc boolean flags.

```typescript
// src/hooks/useKeybindings.ts

type EditorMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND';

// Mode transitions:
// NORMAL  → INSERT:  i, a, o, A, I, O
// INSERT  → NORMAL:  Escape
// NORMAL  → VISUAL:  v, V
// VISUAL  → NORMAL:  Escape
// NORMAL  → COMMAND: :
// COMMAND → NORMAL:  Escape | Enter (after executing)
```

- Mode is stored in `useSettingsStore`, not local component state (so StatusBar can display it).
- Every keydown in `TerminalPane` passes through `useKeybindings` before reaching xterm.js.
- In INSERT mode, all keystrokes pass directly to xterm. In NORMAL mode, keybindings intercept first.

### Theme System (Tailwind v4)

Themes are CSS custom properties declared in `@theme {}` in `globals.css`. The `data-theme` attribute on `<html>` switches between them. Never hardcode colors in components.

```css
/* src/styles/globals.css */
@import "tailwindcss";

/* Default (dark) theme */
@theme {
  --color-term-bg:        #0d0d0d;
  --color-term-fg:        #e8e8e8;
  --color-term-cursor:    #f0c060;
  --color-term-selection: rgba(255,255,255,0.15);
  --color-ui-bg:          #111111;
  --color-ui-surface:     #1a1a1a;
  --color-ui-border:      #2a2a2a;
  --color-ui-text:        #cccccc;
  --color-ui-muted:       #666666;
  --color-ui-accent:      #f0c060;
  --color-ai-bar:         #161b22;
}

/* Light theme override */
[data-theme="light"] {
  --color-term-bg:    #ffffff;
  --color-term-fg:    #1a1a1a;
  --color-ui-bg:      #f5f5f5;
  --color-ui-surface: #ffffff;
  --color-ui-border:  #e0e0e0;
  --color-ui-text:    #1a1a1a;
  --color-ui-muted:   #888888;
}
```

xterm.js `ITheme` is built by reading these CSS variables at runtime — do not duplicate color values.

---

## 11. AI Integration Architecture

### Overview

aurora-term supports **5 first-class providers**. The user sets their API keys in settings; the system automatically routes each task to the appropriate model tier within that provider based on task complexity. No manual model selection is needed — the router picks the cheapest model that can handle the job.

**Supported providers (as of May 2026):**

| Provider | API Docs | Base URL | Auth Header |
|---|---|---|---|
| Anthropic | https://docs.anthropic.com/en/api | `https://api.anthropic.com` | `x-api-key` |
| OpenAI | https://platform.openai.com/docs/api-reference | `https://api.openai.com` | `Authorization: Bearer` |
| Google Gemini | https://ai.google.dev/gemini-api/docs | `https://generativelanguage.googleapis.com` | `x-goog-api-key` |
| NVIDIA NIM | https://build.nvidia.com/docs | `https://integrate.api.nvidia.com/v1` | `Authorization: Bearer` (OpenAI-compatible) |
| Ollama (local) | https://ollama.com/docs | `http://localhost:11434` | none |

---

### Model Tiers & Task Routing

Every AI call in aurora-term is classified into one of three **task tiers**. The router selects the cheapest model in the user's active provider that fits that tier. The user never manually picks a model.

#### Tier Definitions

| Tier | Task Examples | Token Budget | Latency Target |
|---|---|---|---|
| `FAST` | Autocomplete a partially typed command, inline syntax fix, single-word corrections | ≤ 200 tokens out | < 500ms |
| `BALANCED` | Translate natural language → shell command, explain a 10-line error, summarize a short output | ≤ 800 tokens out | < 2s |
| `POWERFUL` | Deep error diagnosis across 100+ lines of output, multi-step workflow generation, ambiguous natural language with context reconstruction | ≤ 3000 tokens out | < 8s |

#### Tier → Model Mapping per Provider

Always check provider docs for model deprecations before building. Models listed here are current as of May 2026.

**Anthropic**

| Tier | Model | Notes |
|---|---|---|
| `FAST` | `claude-haiku-4-5-20251015` | Fastest, cheapest. $1/$5 per MTok |
| `BALANCED` | `claude-sonnet-4-6-20260217` | Best price/perf. $3/$15 per MTok |
| `POWERFUL` | `claude-opus-4-7-20260416` | Max capability. $5/$25 per MTok |

**OpenAI**

| Tier | Model | Notes |
|---|---|---|
| `FAST` | `gpt-5-mini` | Cheapest reasoning model |
| `BALANCED` | `gpt-5.4-mini` | Strong balance of speed and quality |
| `POWERFUL` | `gpt-5.5` | Latest flagship (released April 23, 2026) |

**Google Gemini**

| Tier | Model | Notes |
|---|---|---|
| `FAST` | `gemini-3.1-flash-lite` | Fastest/cheapest. GA as of May 2026 |
| `BALANCED` | `gemini-3.5-flash` | GA as of May 2026, best price/perf |
| `POWERFUL` | `gemini-3.1-pro` | Deep reasoning, 2M context |

**NVIDIA NIM** (OpenAI-compatible endpoint at `https://integrate.api.nvidia.com/v1`)

| Tier | Model | Notes |
|---|---|---|
| `FAST` | `meta/llama-3.1-8b-instruct` | Small, fast |
| `BALANCED` | `meta/llama-4-scout-17b-16e-instruct` | Good balance |
| `POWERFUL` | `meta/llama-3.1-405b-instruct` | Largest open model |

**Ollama** (local, no API key needed)

| Tier | Model | Notes |
|---|---|---|
| `FAST` | `llama3.2:3b` | Pull with: `ollama pull llama3.2:3b` |
| `BALANCED` | `llama3.1:8b` | Pull with: `ollama pull llama3.1:8b` |
| `POWERFUL` | `llama3.1:70b` | Requires 48GB+ VRAM |

> **Model names change often.** The `providers.rs` module must read the model IDs from `config.toml` (with these as defaults), not hardcode them. Users can override any tier's model string in settings.

---

### Rust File Structure for AI

```
src-tauri/src/ai/
├── mod.rs           ← re-exports, AiRouter
├── router.rs        ← TaskTier enum + routing logic
├── client.rs        ← shared reqwest client, SSE streaming helpers
├── providers/
│   ├── mod.rs       ← AiProvider trait
│   ├── anthropic.rs ← /v1/messages, SSE format
│   ├── openai.rs    ← /v1/chat/completions, SSE format (also used by NVIDIA NIM)
│   ├── gemini.rs    ← /v1beta/models/{model}:streamGenerateContent
│   └── ollama.rs    ← /api/chat, Ollama SSE format
└── prompts.rs       ← const system prompts
```

---

### AiProvider Trait

All providers implement a single trait. The router calls through this trait — never calls a provider directly.

```rust
// src-tauri/src/ai/providers/mod.rs

use async_trait::async_trait;
use crate::error::AppError;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiMessage {
    pub role:    String,  // "user" | "assistant" | "system"
    pub content: String,
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Return the model string for this tier from the user's config.
    fn model_for_tier(&self, tier: TaskTier) -> &str;

    /// Stream a completion. Emits "ai_stream_chunk" events on `window`.
    async fn stream_completion(
        &self,
        messages:   Vec<AiMessage>,
        tier:       TaskTier,
        window:     tauri::Window,
        request_id: String,
    ) -> Result<(), AppError>;
}
```

---

### TaskTier & Router

```rust
// src-tauri/src/ai/router.rs

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub enum TaskTier {
    Fast,      // autocomplete, single-line fix
    Balanced,  // translate NL → command, explain short error
    Powerful,  // deep diagnosis, multi-step workflow
}

/// Classify a task before sending to a provider.
/// Called internally — never exposed as a Tauri command.
pub fn classify_task(task: &AiTask) -> TaskTier {
    match task {
        AiTask::Autocomplete { .. }         => TaskTier::Fast,
        AiTask::InlineFix { .. }            => TaskTier::Fast,
        AiTask::TranslateCommand { .. }     => TaskTier::Balanced,
        AiTask::ExplainError { output_len, .. } if *output_len < 500 => TaskTier::Balanced,
        AiTask::ExplainError { .. }         => TaskTier::Powerful,
        AiTask::GenerateWorkflow { .. }     => TaskTier::Powerful,
        AiTask::DeepDiagnosis { .. }        => TaskTier::Powerful,
    }
}

pub struct AiRouter {
    provider: Box<dyn AiProvider>,
}

impl AiRouter {
    pub async fn run(
        &self,
        task:       AiTask,
        window:     tauri::Window,
        request_id: String,
    ) -> Result<(), AppError> {
        let tier     = classify_task(&task);
        let messages = task.into_messages();
        self.provider.stream_completion(messages, tier, window, request_id).await
    }
}
```

---

### Provider Config in `config.toml`

Each provider stores its API key separately (written to OS keychain, not config file — see Security below). The config file only stores non-secret settings.

```toml
[ai]
active_provider = "anthropic"   # "anthropic" | "openai" | "gemini" | "nvidia" | "ollama"
auto_explain    = true          # auto-explain non-zero exit codes
context_lines   = 50            # lines of output sent as context

# Per-provider model overrides (defaults listed; user can change any tier)
[ai.anthropic]
fast_model     = "claude-haiku-4-5-20251015"
balanced_model = "claude-sonnet-4-6-20260217"
powerful_model = "claude-opus-4-7-20260416"

[ai.openai]
fast_model     = "gpt-5-mini"
balanced_model = "gpt-5.4-mini"
powerful_model = "gpt-5.5"

[ai.gemini]
fast_model     = "gemini-3.1-flash-lite"
balanced_model = "gemini-3.5-flash"
powerful_model = "gemini-3.1-pro"

[ai.nvidia]
fast_model     = "meta/llama-3.1-8b-instruct"
balanced_model = "meta/llama-4-scout-17b-16e-instruct"
powerful_model = "meta/llama-3.1-405b-instruct"
base_url       = "https://integrate.api.nvidia.com/v1"

[ai.ollama]
fast_model     = "llama3.2:3b"
balanced_model = "llama3.1:8b"
powerful_model = "llama3.1:70b"
base_url       = "http://localhost:11434"
```

---

### API Key Security

API keys are **never stored in `config.toml`**. They are stored in the OS native keychain via Tauri's keyring plugin.

```toml
# src-tauri/Cargo.toml — add keyring plugin
tauri-plugin-keyring = "2"
```

```rust
// Writing a key (from settings UI save)
tauri_plugin_keyring::set_password("aurora-term", "anthropic_api_key", &api_key)?;

// Reading a key (before each AI request)
let api_key = tauri_plugin_keyring::get_password("aurora-term", "anthropic_api_key")?;
```

On Windows: Windows Credential Manager. On macOS: Keychain. On Linux: libsecret / KWallet.

**Never** log API keys. **Never** include them in error messages. **Never** send them to the frontend.

---

### OpenAI-Compatible Providers (OpenAI + NVIDIA NIM)

Both OpenAI and NVIDIA NIM use the same `/v1/chat/completions` schema with SSE streaming. Implement `openai.rs` once and pass `base_url` as a constructor parameter. NVIDIA NIM uses the same struct with `base_url = "https://integrate.api.nvidia.com/v1"`.

```rust
// src-tauri/src/ai/providers/openai.rs

pub struct OpenAiCompatProvider {
    client:         reqwest::Client,
    api_key:        String,
    base_url:       String,
    fast_model:     String,
    balanced_model: String,
    powerful_model: String,
}

// NVIDIA NIM is just:
// OpenAiCompatProvider { base_url: "https://integrate.api.nvidia.com/v1", ... }
```

---

### Gemini Provider Notes

Gemini uses a different API shape from OpenAI. Its streaming endpoint is:
`POST /v1beta/models/{model}:streamGenerateContent?alt=sse`

Request body uses `contents` (not `messages`) and `systemInstruction` (not a `system` role message). Implement `gemini.rs` separately — do not try to wedge it into the OpenAI-compatible struct.

```rust
// Key differences to implement in gemini.rs:
// 1. Auth: query param ?key={api_key} OR header x-goog-api-key
// 2. Body: { "systemInstruction": { "parts": [{"text": "..."}] }, "contents": [...] }
// 3. SSE chunks: data: {"candidates": [{"content": {"parts": [{"text": "..."}]}}]}
// 4. Model ID in URL path, not body
```

---

### Ollama Provider Notes

Ollama uses `/api/chat` with its own streaming format (newline-delimited JSON, not SSE).

```rust
// Key differences to implement in ollama.rs:
// 1. No auth header needed
// 2. Endpoint: POST http://localhost:11434/api/chat
// 3. Body: { "model": "...", "messages": [...], "stream": true }
// 4. Stream: newline-delimited JSON objects, not SSE
//    Each line: {"message": {"role": "assistant", "content": "..."}, "done": false}
//    Final line: {"done": true}
// 5. Check if Ollama is running before making requests: GET /api/tags
//    Emit a "ollama_not_running" event if connection refused
```

---

### System Prompts

All system prompts are `const &str` in `src-tauri/src/ai/prompts.rs`. Never construct system prompts dynamically. Shell context (cwd, shell name, recent history) is injected into the **user turn**, not the system prompt.

```rust
// src-tauri/src/ai/prompts.rs

pub const TRANSLATE_COMMAND_SYSTEM: &str = r#"
You are an expert shell command translator.
Given a natural language description and shell context, output ONLY the exact shell command.
No explanation. No markdown. No backticks.
If the command is dangerous (rm -rf, format, wipefs, dd), prefix with DANGER: and explain why.
"#;

pub const EXPLAIN_ERROR_SYSTEM: &str = r#"
You are a terminal error analyst.
Given a command, its output, and exit code, give a concise explanation (max 3 sentences)
of what went wrong and the most likely fix. Be direct. No preamble.
"#;

pub const AUTOCOMPLETE_SYSTEM: &str = r#"
You are a shell command autocomplete engine.
Given a partial command and shell context, output ONLY the most likely completion of that command.
Output the completion suffix only — not the full command, not any explanation.
If no completion is obvious, output an empty string.
"#;

pub const WORKFLOW_SYSTEM: &str = r#"
You are a shell workflow architect.
Given a goal described in natural language and the user's shell environment,
output a sequence of shell commands that accomplish the goal.
Format: one command per line. No explanation. No markdown fences.
Prefix dangerous commands with # DANGER: reason
"#;
```

---

### Frontend: Provider Settings UI

The settings modal has a **Providers** tab. It shows all 5 providers. For each:
- Enable/disable toggle
- API key input (masked, write-only — never displayed after saving)
- A "Test connection" button that calls `invoke("ai_test_provider", { provider })` 
- Model overrides (collapsed by default, expandable)

The active provider badge is shown in the StatusBar next to the current mode indicator.

```typescript
// src/types/ai.ts

export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'nvidia' | 'ollama';

export type TaskTier = 'fast' | 'balanced' | 'powerful';

export interface ProviderConfig {
  name:           ProviderName;
  enabled:        boolean;
  hasApiKey:      boolean;  // true if a key exists in keychain — never the key itself
  fastModel:      string;
  balancedModel:  string;
  powerfulModel:  string;
  baseUrl?:       string;   // only for nvidia and ollama
}

export interface AiState {
  activeProvider:  ProviderName;
  providers:       Record<ProviderName, ProviderConfig>;
  pendingRequests: Map<string, { tier: TaskTier; abortable: boolean }>;
  streamingText:   string | null;
}
```

---

### IPC Commands for Provider Management

```typescript
// Additions to src/lib/ipc.ts

export const ai = {
  // ... existing commands ...

  setProvider: (provider: ProviderName) =>
    invoke<void>('ai_set_provider', { provider }),

  saveApiKey: (provider: ProviderName, key: string) =>
    invoke<void>('ai_save_api_key', { provider, key }),

  deleteApiKey: (provider: ProviderName) =>
    invoke<void>('ai_delete_api_key', { provider }),

  testProvider: (provider: ProviderName) =>
    invoke<boolean>('ai_test_provider', { provider }),  // true = OK

  updateModelOverride: (provider: ProviderName, tier: TaskTier, model: string) =>
    invoke<void>('ai_update_model', { provider, tier, model }),

  getProviderStatus: () =>
    invoke<Record<ProviderName, boolean>>('ai_provider_status'),
};
```

---

## 11.5 GPU Rendering Engine (WebGL Architecture)

### Why It Is Present
aurora-term integrates the `@xterm/addon-webgl` graphics pipeline to achieve high-performance, hardware-accelerated console rendering. It is designed to satisfy intense command streams under high-resolution workloads (such as high-DPI 4K and 8K screens) at a stable 60fps+ refresh rate:
- **GPU Texture Atlas**: Characters and glyphs are rendered via vertex/fragment shaders and cached in video memory as a dynamic texture atlas. Instead of drawing cells cell-by-cell on the CPU (which saturates the system bus), the GPU renders the entire viewport in unified instanced draw calls.
- **frame Budget Discipline (rAF Batching)**: Incoming PTY streams are buffered and parsed exactly once per animation frame using `requestAnimationFrame`, preventing main thread event storms and maintaining stable frame times.
- **Concurrent Transition Bounds**: Visual overlay recalculations are throttled at 60fps and wrapped in React 18's low-priority concurrent `startTransition` hooks. This ensures system coordinates calculations never block high-priority key inputs or core character typing.
- **Teardown & Crash Isolation**: Contains runtime context-loss listener recycling and asynchronous `isDisposed` safety gates to gracefully absorb WebGL/Vite HMR/React StrictMode unmounting exceptions, preventing blank-screen app crashes.

### Outstanding Performance Roadmaps (TODOs)
- [ ] **Compositor Layer Promotion**: Position the overlay widgets in `TerminalBlock.tsx` using GPU-promoted `transform: translate3d(0, y, 0)` instead of standard CSS `top` layout rules to bypass browser layout reflows and offload overlays to the GPU compositor.
- [ ] **Multi-Threaded PTY Parsing**: Move PTY data stream parsing and xterm operations entirely to a background Web Worker utilizing an `OffscreenCanvas` to guarantee main thread responsiveness under extreme console outputs.
- [ ] **High-DPI Dynamic Atlas Tuning**: Automatically scale the font texture atlas dimensions dynamically during high-DPI monitor changes or dynamic window scaling to prevent pixelated font fallback render paths.
- [ ] **PTY IPC Flow Control**: Integrate backpressure flow control in the Tauri Rust backend to pause command writing if the WebGL renderer falls behind by more than 2 frames.

---

## 12. Database Schema

```sql
-- src-tauri/migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS command_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT    NOT NULL,
    command     TEXT    NOT NULL,
    cwd         TEXT    NOT NULL,
    exit_code   INTEGER,
    duration_ms INTEGER,
    created_at  INTEGER NOT NULL   -- Unix timestamp ms
);

CREATE INDEX idx_history_command ON command_history(command);
CREATE INDEX idx_history_created ON command_history(created_at DESC);

CREATE TABLE IF NOT EXISTS snippets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    command     TEXT    NOT NULL,
    description TEXT,
    tags        TEXT,              -- JSON array ["git","deploy"]
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT    PRIMARY KEY,  -- uuid
    name        TEXT,
    shell       TEXT    NOT NULL,
    cwd         TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    last_used   INTEGER NOT NULL
);
```

- Database file path resolved via `app.path().app_data_dir()` — never hardcoded.
- Windows: `%APPDATA%\aurora-term\history.db`
- Linux/macOS: `~/.local/share/aurora-term/history.db`
- Run migrations on startup in `HistoryDb::new()`. Track version in a `schema_version` table.

---

## 13. Config Schema

```toml
# Resolved via app.path().app_config_dir() / aurora-term / config.toml

[terminal]
shell         = "powershell"   # or "cmd", "bash", "zsh", "fish"
font_family   = "JetBrains Mono"
font_size     = 14
scrollback    = 10000
theme         = "dark"
cursor_style  = "block"        # "block" | "underline" | "bar"
cursor_blink  = true

# AI provider settings — see Section 11 for full schema
# API keys are stored in OS keychain, never here
[ai]
active_provider = "anthropic"   # "anthropic" | "openai" | "gemini" | "nvidia" | "ollama"
auto_explain    = true
context_lines   = 50

[ai.anthropic]
fast_model     = "claude-haiku-4-5-20251015"
balanced_model = "claude-sonnet-4-6-20260217"
powerful_model = "claude-opus-4-7-20260416"

[ai.openai]
fast_model     = "gpt-5-mini"
balanced_model = "gpt-5.4-mini"
powerful_model = "gpt-5.5"

[ai.gemini]
fast_model     = "gemini-3.1-flash-lite"
balanced_model = "gemini-3.5-flash"
powerful_model = "gemini-3.1-pro"

[ai.nvidia]
fast_model     = "meta/llama-3.1-8b-instruct"
balanced_model = "meta/llama-4-scout-17b-16e-instruct"
powerful_model = "meta/llama-3.1-405b-instruct"
base_url       = "https://integrate.api.nvidia.com/v1"

[ai.ollama]
fast_model     = "llama3.2:3b"
balanced_model = "llama3.1:8b"
powerful_model = "llama3.1:70b"
base_url       = "http://localhost:11434"

[keybindings]
mode          = "vim"          # "vim" | "default"
open_palette  = "ctrl+p"
open_ai_bar   = "ctrl+k"
new_tab       = "ctrl+t"
close_tab     = "ctrl+w"
split_h       = "ctrl+shift+d"
split_v       = "ctrl+shift+e"

[appearance]
compact_ui     = false
show_statusbar = true
blur_sidebar   = false
```

---

## 14. Keybinding Reference

| Mode | Key | Action |
|---|---|---|
| Any | `Ctrl+P` | Open command palette |
| Any | `Ctrl+K` | Open AI command bar |
| Any | `Ctrl+T` | New tab |
| Any | `Ctrl+W` | Close tab |
| Any | `Ctrl+Shift+D` | Split horizontal |
| Any | `Ctrl+Shift+E` | Split vertical |
| Any | `Ctrl+Shift+F` | Search in output |
| Normal | `i` | Enter INSERT mode |
| Normal | `:` | Enter COMMAND mode |
| Normal | `j/k` | Scroll output |
| Normal | `G` | Jump to latest output |
| Normal | `gg` | Jump to top of output |
| Normal | `yy` | Copy current line |
| Normal | `dd` | Delete input line |
| Normal | `/` | Search history |
| COMMAND | `:w` | Bookmark current block |
| COMMAND | `:q` | Close current pane |
| COMMAND | `:vs` | Vertical split |
| COMMAND | `:tabnew` | New tab |

---

## 15. Design Constraints & Rules

### Never Do
- ❌ Never use `unwrap()` or `expect()` in production code paths. Use `?` with `AppError`.
- ❌ Never store the AI API key in plain text on disk, in `config.toml`, or in `localStorage`. Use OS keychain via `tauri-plugin-keyring`.
- ❌ Never log API keys or include them in error messages or Tauri events.
- ❌ Never send an API key to the frontend — only send `hasApiKey: bool`.
- ❌ Never hardcode model strings in Rust source. Always read from `AppConfig`. Users must be able to override any tier's model.
- ❌ Never call a provider struct directly from a Tauri command. Always go through `AiRouter`.
- ❌ Never use `features = ["full"]` or `features = ["all"]` on any crate. Only enable what you use.
- ❌ Never create `tailwind.config.ts`. Tailwind v4 is configured in CSS via `@theme {}`.
- ❌ Never add `autoprefixer` or `postcss` packages. Tailwind v4 + Vite doesn't need them.
- ❌ Never use the old `xterm` npm package. Use `@xterm/xterm` (the scoped package).
- ❌ Never hardcode paths like `C:\Users\` or `~/.config`. Always use Tauri's path API.
- ❌ Never add `panic = "unwind"` in release profile. Keep `panic = "abort"` for size.

### Always Do
- ✅ Mirror every Rust IPC struct in `src/types/ipc.ts`.
- ✅ Emit Tauri events with typed payload structs, not raw strings.
- ✅ Use `tracing::info!` / `tracing::error!` in Rust, never `println!`.
- ✅ Use `uuid::Uuid::new_v4().to_string()` for all generated IDs.
- ✅ Apply `data-theme` attribute on `<html>` element for theme switching.
- ✅ Run `cargo bloat --release --crates` before every release. Fix regressions immediately.
- ✅ Run `npx vite-bundle-visualizer` before every release.
- ✅ Keep `@tauri-apps/api` npm version in sync with `tauri` Cargo crate minor version.
- ✅ Use `npm run tauri dev` for development — never serve the Vite frontend standalone.
- ✅ Check https://v2.tauri.app/develop/updating-dependencies/ when bumping any Tauri dep.

---

## 16. Performance Guidelines

- **PTY reader buffer:** Read in 4096-byte chunks. Batch-emit if multiple chunks arrive within 16ms (one frame) to avoid flooding React with events.
- **xterm.js writes:** Batch writes using `terminal.write(data)` — xterm handles its own render loop. Never call `write` from multiple places simultaneously.
- **History search:** Via `nucleo` in Rust through IPC. Do not filter on the JS side unless the result set is < 200 items.
- **Block rendering:** Virtualize the block list with `@tanstack/react-virtual` (React 19 compatible) if a session has > 100 blocks.
- **AI requests:** Cancel in-flight `reqwest` streams if the user closes the AI bar. Track `AbortHandle` per request in `AppState`.
- **Config reads:** Config is loaded once into `AppState`. Never read from disk per-request.
- **Startup time target:** Cold launch ≤ 800ms. Dev mode TTI ≤ 300ms after Rust is compiled.
- **React 19 compiler:** Enable `babel-plugin-react-compiler` — with React 19 it eliminates most manual `useMemo`/`useCallback`. Do not add manual memoization until profiling proves it's needed.

---

## 17. Testing Strategy

### Rust
- Unit tests in the same file using `#[cfg(test)]` for pure functions (prompt builders, config parsers, ANSI helpers).
- Integration tests in `src-tauri/tests/` for DB migrations and PTY spawn/kill lifecycle.
- No mocking framework — use dependency injection (pass `reqwest::Client` as a parameter to AI functions so tests can substitute a mock server via `wiremock`).

### Frontend
- `vitest` v4.x for hook and store unit tests.
- Test `useBlockStore` state transitions directly — no component mounting needed.
- Test `ipc.ts` wrappers by mocking `@tauri-apps/api/core`'s `invoke`.
- No snapshot tests. Test behavior, not markup.

---

## 18. Build & Release

```powershell
# Development
npm run tauri dev

# Production build (Windows)
npm run tauri build
# Output: src-tauri/target/release/bundle/msi/aurora-term_*.msi
#         src-tauri/target/release/bundle/nsis/aurora-term_*-setup.exe

# Size audit (run before every release)
./scripts/size-audit.ps1

# Rust tests only
cd src-tauri && cargo test

# Frontend tests only
npm run test

# Type check without building
npm run typecheck

# Lint Rust (zero warnings policy)
cd src-tauri && cargo clippy -- -D warnings
```

**Release checklist:**
1. Update version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` — all three together.
2. Run `cargo clippy -- -D warnings` — zero warnings.
3. Run `npm run typecheck` — zero TypeScript errors (TS 6 strict mode).
4. Run `./scripts/size-audit.ps1` — binary must be under 15 MB.
5. Test PTY spawn/kill on each target OS before tagging.
6. Verify `@tauri-apps/api` npm version matches `tauri` Cargo crate minor.

---

## 19. Open Questions / Future Work

- [x] GPU rendering: integrated xterm.js WebGL and fit-addon systems to support hardware-accelerated 4K drawing at 60fps
- [ ] Protocol support: native SSH sessions via `russh` crate vs spawning system SSH
- [ ] Collaboration: WebRTC session sharing for pair programming
- [ ] Plugin system: WASM-based plugins for custom output renderers
- [ ] Workflow DSL: design the TOML schema for chained command workflows
- [ ] Mobile: Tauri iOS/Android builds for remote shell use case
- [ ] TypeScript 7.0: migrate once stable (Go-based compiler, 10x faster builds)

---

*Last updated: 2026-05-25. Update this file whenever architecture decisions change.*