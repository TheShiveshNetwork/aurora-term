# 🌌 Aurora Term

A lightweight, high-performance, and extremely powerful **Agentic Terminal** designed for developers and AI-assisted workflows. Powered by **Tauri v2**, **React 19**, **Rust**, and **xterm.js**, Aurora provides a beautiful, modern terminal experience with full command decoupling, sandboxed tab execution, and future-proof AI integration.

## 📸 Screenshots

| Startup Overview (Empty State) | Executing Command (Warp-style Blocks) |
| :---: | :---: |
| ![Startup Overview](https://raw.githubusercontent.com/TheShiveshNetwork/aurora-term/main/static/screenshots/terminal_empty_state.png) | ![Executing Command](https://raw.githubusercontent.com/TheShiveshNetwork/aurora-term/main/static/screenshots/command_output_blocks.png) |

---

## 🚀 The Vision
Traditional terminals force you to look at raw shell prompts, repeated echos, and cluttered command inputs. **Aurora Term** completely reimagines this experience by:
* Decoupling the input bar from the viewport (Warp-style glowing command bar).
* Automatically parsing directory contexts and Git branches using background stream sentinels.
* Sandboxing every terminal session independently.
* Paving the way for local and cloud-based AI agent execution directly in your workspace.

---

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

---

## ✨ Features Implemented Till Now

### 🏁 Decoupled Command Rendering & Prompts
* **Warp-Style Layouts**: Command outputs render clean and promptless inside the xterm viewport. 
* **Dynamic Block Headers**: Every executed command receives a bold, colorful block header depicting `folder (git-branch) > command` using ANSI escape formatting.
* **Global Prompt & Echo Stripper**: Custom regex parsers strip raw `PS>`, `>>`, and duplicate command echos from the shell's output stream before writing to the terminal.
* **Invisible Cursor Mode**: Customized cursor CSS fully removes block/bar cursors from the terminal render area for a clean card output look.

### 🗂️ Sandboxed Tab Management & CWD Synchronization
* **Isolated Shell Sessions**: Every tab runs a separate, fully sandboxed PTY process.
* **Tab-Specific CWD Mapping**: App tracks the active working directory for every tab separately. Switching tabs automatically synchronizes the active folder context.
* **Workspace Explorer Sync**: Changing active tabs instantly reloads the SidePanel file tree to show the files in the active session's directory.
* **Folder Loader transitions**: Replaces folder labels with a rotating loader spinner when CWD is in transition (during `cd` commands), guaranteeing zero transitional path flashes.
* **Safe Sentinel Path Validation**: Custom filesystem validators ignore command echoes and shell variables, ensuring only valid absolute paths reach the explorer.

### 📂 File Explorer Sidebar
* **Premium Loading Micro-Animations**: Interactive search input stretches to 100% width, hiding the dynamic sidebar spinner once folder tree loads are complete.
* **Workspace Name Resolution**: Displays the current workspace root directory dynamically.
* **Drag-to-Resize split**: Standard horizontal split row layout with a smooth resizing grip, keeping the SidePanel on the left and TabBar/terminals vertically stacked on the right.

### 🖱️ Viewport-Clamped Context Menu
* **Immediate Pre-Capture Copy**: Right-clicking the terminal immediately extracts the highlighted selection before focus shifts, guaranteeing 100% reliable copying.
* **Paste Forwarding**: Reads the system clipboard and appends text directly to the bottom glowing command input.
* **Clear Visuals**: Wipes the active visual terminal screen and flushes the Zustand history lists instantly.
* **Boundary-Aware Clamping**: Dynamically measures the menu's DOM dimensions (`useLayoutEffect`) and clamps its coordinates within the app view (up, down, left, right) with an `8px` safety margin to prevent boundary overflows.

---

## 🔮 Future Roadmap (To Be Implemented)

We are actively developing Aurora into the ultimate lightweight agentic terminal interface:

- [ ] **📂 Interactive File View**:
  - Embedded file previewer for fast file inspections.
  - Lightweight markdown rendering and code editor panels.
- [ ] **🤖 Agentic System**:
  - Autonomous local workflow executor capable of running complex multi-step terminal actions.
  - Direct task tracking checklist rendering inside a dedicated side-panel.
- [ ] **💻 Local Model Running**:
  - Offline LLM execution via Ollama, Llama.cpp, or ONNX runtimes.
  - Zero-latency local completion, command prediction, and explanation.
- [ ] **☁️ Cloud Model Connections**:
  - Direct multi-provider connections for Anthropic (Claude), OpenAI (GPT-4o), Gemini, and DeepSeek.
  - Safe API-key vaults stored in local secure keychain credentials.
- [ ] **⚡ Smart Command Palette**:
  - Visual keyboard-shortcut actions menu.
  - Multi-session CLI automation scripting.

---

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
