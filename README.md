<p align="center">
  <img src="tauri/icons/Square142x142Logo.png" width="96" alt="Aurora logo" />
</p>

# Aurora Term

A lightweight, high-performance, and extremely powerful **Agentic Terminal** designed for developers and AI-assisted workflows. Powered by **Tauri v2**, **React 19**, **Rust**, and **xterm.js**, Aurora provides a beautiful, modern terminal experience with full command decoupling, sandboxed tab execution, and future-proof AI integration.

<img src="https://raw.githubusercontent.com/TheShiveshNetwork/aurora-term/main/static/screenshots/command_output_blocks.png" />

## 🛠️ Development

### Prerequisites
* **Rust**: [Install Rust](https://www.rust-lang.org/tools/install)
* **Node.js**: [Install Node.js (v18+)](https://nodejs.org/)

### Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run in development mode**:
   ```bash
   npm run tauri dev
   ```

3. **Verify compilation & type safety**:
   ```bash
   npm run typecheck
   ```

4. **Build production bundle**:
   ```bash
   npm run tauri build
   ```

## Workspace tree

```text
aurora-term/
├── Cargo.toml
├── Cargo.lock
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json
├── index.html
├── README.md
├── AGENT.md
├── adr/
├── app/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
├── packages/
│   ├── types/
│   └── aurora-agent/
├── crates/
│   ├── aurora-core/
│   ├── aurora-pty/
│   ├── aurora-db/
│   ├── aurora-config/
│   ├── aurora-sidecar/
│   ├── aurora-ai/
│   └── aurora-commands/
├── tauri/
├── scripts/
└── static/
```

## Development

```bash
pnpm install
pnpm --dir app typecheck
pnpm tauri dev
```

## What is built

### Rust workspace crates

| Crate | Why it exists | Main requirements |
|---|---|---|
| `aurora-core` | Shared domain types and errors used by every backend crate | `serde`, `serde_json`, `thiserror`, `uuid`, `chrono`, `toml` |
| `aurora-pty` | PTY session lifecycle and terminal I/O | `tokio`, `portable-pty`, `aurora-core`, `which`, `tracing` |
| `aurora-db` | SQLite command history and fuzzy search | `rusqlite`, `nucleo`, `aurora-core`, `chrono`, `tracing` |
| `aurora-config` | Load/save app config and keychain-backed secrets | `tauri`, `toml`, `keyring`, `aurora-core` |
| `aurora-sidecar` | Manage the sidecar process lifecycle and health checks | `tokio`, `reqwest`, `which`, `aurora-core`, `aurora-config` |
| `aurora-ai` | AI provider abstraction and streaming responses | `tauri`, `reqwest`, `async-trait`, `futures-util`, `aurora-core` |
| `aurora-commands` | Tauri command handlers that glue the backend together | `tauri`, `tokio`, `serde`, `uuid`, `chrono`, `base64`, `ignore`, `sysinfo`, `notify`, `rfd`, `which`, plus all core crates |
| `tauri` | Native app shell and binary entrypoint | `tauri-build`, `tauri`, `tauri-plugin-opener`, `tauri-plugin-prevent-default`, plus the core crates |

### pnpm workspace packages

| Package | Why it exists | Main requirements |
|---|---|---|
| `app` (`@aurora/app`) | Main React frontend for the Tauri window | `react`, `react-dom`, `vite`, `typescript`, `@tauri-apps/api`, `@xterm/*`, `zustand`, `tailwindcss` |
| `packages/types` (`@aurora/types`) | Shared TypeScript types used by the frontend | TypeScript-only shared models; no runtime build output |
| `packages/aurora-agent` (`aurora-agent`) | AI agent sidecar server (Fastify + Mastra) that plans and executes multi-step terminal tasks via LLM | `fastify`, `@mastra/core`, `@mastra/libsql`, `@mastra/memory`, `dotenv`, `zod` |

## Natural Language Command Classification

Aurora automatically detects whether your input is a **shell command** or a **natural language request** using a local heuristic classifier (`app/src/lib/nlClassifier.ts`). This happens entirely on the client — no data leaves your machine until you press Enter in agent mode.

### How it works

1. **Explicit overrides**: Inputs starting with `? ` or `/ai ` always route to the agent.
2. **Heuristic scoring**: The classifier scores the input using three signals:
   - **Known command match** (e.g., `git`, `curl`, `npm`, `dir`, `Get-ChildItem`) — weighted high (score `0.7`)
   - **Shell-specific command sets** — PowerShell cmdlets (`Verb-Noun` pattern) vs bash commands; detected via `isWindowsPlatform()`
   - **NL verbs** (e.g., `install`, `run`, `build`, `deploy`, `create`) — weighted low (score `0.1`), only scored when the verb is NOT a valid subcommand of a known tool (e.g., `npm install` won't be classified as NL)
3. **Social greeting blocker**: Greetings like `hi`, `hello`, `hey`, `thanks` are classified as NL, not commands
4. **Conservative default**: Unknown inputs default to NL (safe — AI can handle anything; terminal only gets valid commands)

### Agent Execution Flow

```
User input → nlClassifier()
  ├─ "command" → terminal PTY session (direct execution)
  └─ "nl"     → agent mode
                  │
                  ▼
          useAgentStore.startTask(goal)
                  │
                  ▼
          Tauri command: agent_plan_step
            POST http://127.0.0.1:{port}/api/step
            body: { task_id, goal, last_output?, exit_code? }
                  │
                  ▼
          aurora-agent (Fastify + Mastra)
            loads Aura agent → LLM provider (Groq/OpenAI/Kimi)
            returns JSON: { status, command?, explanation?, message? }
                  │
                  ▼
          status = "executing"
            → command is sent to PTY for execution
            → stdout/stderr captured
            → next plan_step call with last_output + exit_code
            → repeat until status = "completed" or "error"
                  │
                  ▼
          status = "completed" → done
          status = "error"     → failTask with message + retry/close UI
```

### Starting the Agent Server

The aurora-agent sidecar is **automatically spawned** by the Rust `SidecarManager` when the app starts. It:

1. Finds a free TCP port (binds `127.0.0.1:0`)
2. Runs `pnpm --dir packages/aurora-agent dev --port <PORT>` (on Windows: via `cmd /c`)
3. Injects API keys from the OS keychain: `GROQ_API_KEY`, `OPENAI_API_KEY`, `KIMI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
4. Polls `/global/health` until ready (up to 3 seconds)
5. Exposes `POST /api/step` for plan/execute requests

To run it **manually** for development:

```bash
cd packages/aurora-agent
pnpm dev                        # defaults to port 4096
pnpm dev --port 5000            # custom port
```

Requires at least one LLM API key set via environment or keychain.

## 🛠️ Tech Stack & Versions

Aurora is built on a state-of-the-art native desktop and web technology stack:

### Frontend
| Technology | Version | Description |
| :--- | :--- | :--- |
| **React** | `^19.2.0` | Declarative UI framework |
| **TypeScript** | `^6.0.0` | Strongly-typed JavaScript superset |
| **Vite** | `^8.0.0` | Next-generation frontend tooling |
| **Tailwind CSS** | `^4.0.0` | Dynamic utility-first CSS styling framework |
| **@xterm/xterm** | `^5.3.0` | High-fidelity hardware-accelerated terminal renderer |
| **@xterm/addon-fit** | `^0.11.0` | Responsive dimensions resizing addon |
| **Zustand** | `^5.0.3` | Lightweight, reactive state management |
| **Lucide React** | `^0.475.0` | Curated premium UI vector icons |

### Backend / Core
| Technology | Version | Description |
| :--- | :--- | :--- |
| **Tauri CLI / API** | `^2.1.0` / `^2.1.1` | Ultra-lightweight native Rust app wrapper |
| **Rust** | `1.75+` | Safe, high-performance backend systems compiler |
| **PTY Manager** | Custom (Rust) | Native Windows/Unix PTY process lifecycle controller |

## 🔮 Future Roadmap (To Be Implemented)

We are actively developing Aurora into the ultimate lightweight agentic terminal interface:

  - Embedded file previewer for fast file inspections.
  - Lightweight markdown rendering and code editor panels.
  - Autonomous local workflow executor capable of running complex multi-step terminal actions.
  - Direct task tracking checklist rendering inside a dedicated side-panel.
  - Offline LLM execution via Ollama, Llama.cpp, or ONNX runtimes.
  - Zero-latency local completion, command prediction, and explanation.
  - Direct multi-provider connections for Anthropic (Claude), OpenAI (GPT-4o), Gemini, and DeepSeek.
  - Safe API-key vaults stored in local secure keychain credentials.
  - Visual keyboard-shortcut actions menu.
  - Multi-session CLI automation scripting.
