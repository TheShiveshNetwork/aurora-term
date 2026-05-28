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
│   └── types/
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
