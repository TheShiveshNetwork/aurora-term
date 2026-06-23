# Aurora-Term: AI OS Master Implementation Plan
> **Codename:** Aurora · **Stack:** Tauri v2 · React 19 · TypeScript · Rust · Mastra · Groq API  
> **Vision:** A production-grade AI-native OS experience — terminal, editor, browser, agent — all agent-controlled via MCP.

---

## 0. Critical Decisions Before You Write a Line

### Groq Free Tier Realities
The free tier gives you **30 RPM, 6,000 TPM, and 1,000 RPD** — at the org level, not per user. At 30 RPM you get one request every 2 seconds. With 5 concurrent active users you saturate the limit immediately. A single long agent turn with rich context can consume your entire per-minute token budget.

**What this means for your free tier:**
- You MUST implement a **per-user request queue** server-side. Do not let users hit Groq directly.
- Track RPD yourself — Groq does not expose it in headers. Reset a counter at midnight UTC.
- Read `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` on every response. Implement backoff before hitting 429s, not after.
- Free tier users should get a **daily credit budget** (e.g., 20 agent turns/day), not raw API access.
- Use **Llama 3.1 8B** for cheap, fast tasks (code search, file reads, classification). Reserve **Llama 3.3 70B** for actual reasoning turns. This is your primary cost lever.
- Consider **prompt caching** (50% off) and **Batch API** (50% off) for background tasks like indexing, summarization, and memory compaction.
- Upgrade path: add a credit card for the Developer tier — up to 10x limits, 25% discount, no charge without usage.

### Mastra Memory — Per-User Isolation
Yes, implement Mastra memory. Yes, it must be per-user.

- Each user gets a unique `threadId` (UUID tied to their account) that persists across sessions.
- Mastra's `threadId` is what isolates conversation history. Never share a threadId between users.
- Project memory (the `AGENTS.md` / `.aurora/` dir) is per-workspace, not per-user — it belongs to the repo.
- Cross-session observational memory (facts like "this user prefers Bun over Node") should be stored in your own DB keyed by `userId`, then injected into the Mastra agent's system prompt at session start as a "user context" block.
- Do NOT use a shared Mastra instance with a global memory store. Each API request should instantiate or retrieve an agent scoped to that user's threadId.

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        TAURI v2 SHELL                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   Terminal   │  │Text Editor   │  │  Browser     │             │
│  │  (xterm.js)  │  │ (Monaco/CM6) │  │  (WebView2)  │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                 │                  │                      │
│  ┌──────▼─────────────────▼──────────────────▼───────┐             │
│  │              Aurora MCP Bridge (Rust)              │             │
│  │   IPC Socket Server · UI Event Bus · Tool Router  │             │
│  └──────────────────────────┬────────────────────────┘             │
│                             │ IPC/WebSocket                        │
└─────────────────────────────┼──────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────┐
│                    MASTRA AGENT SIDECAR (Node.js)                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Agent Orchestrator                        │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │   │
│  │  │  Coder   │ │Terminal  │ │ Browser  │ │  Researcher  │   │   │
│  │  │  Agent   │ │  Agent   │ │  Agent   │ │   Agent      │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Tools: file_* · bash · grep · lsp_* · git_* · browser_* · ui_*   │
│  Memory: Mastra threadId (per user) + project AGENTS.md            │
│  Rate Limiter: Queue · Token Counter · Per-user Budget             │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │ HTTPS
                              ┌────▼─────┐
                              │  Groq API │
                              └──────────┘
```

---

## 2. The Agent Core (Mastra)

### 2.1 Agent Loop
The agent loop is a simple `while` construct. The engineering complexity is entirely in what surrounds it.

```
User input
    │
    ▼
Build context (system prompt + dynamic per-turn injection)
    │
    ▼
┌── Agent Loop ──────────────────────────────────────┐
│  Groq API call (stream)                            │
│       │                                            │
│  Tool calls returned?                              │
│  ├─ Yes → Execute tools (up to 5 concurrent)  ────┘│
│  │         → Feed results back as tool_result     │
│  └─ No  → Exit loop, stream final response        │
└────────────────────────────────────────────────────┘
    │
    ▼
Render to UI · Save to thread · Update memory
```

### 2.2 Multi-Agent Setup (Mastra)

```typescript
// Orchestrator delegates to specialists
const orchestratorAgent = new Agent({
  id: 'orchestrator',
  model: 'groq/llama-3.3-70b-versatile', // big model for routing
  agents: { coderAgent, terminalAgent, browserAgent, researcherAgent },
  tools: { todoWrite, todoRead, spawnSubagent }
})

// Specialist — lean model, scoped tools
const coderAgent = new Agent({
  id: 'coder',
  model: 'groq/llama-3.1-8b-instant', // fast cheap model
  tools: { fileRead, fileWrite, fileEdit, grep, glob, astSearch, lspHover, lspDefinition }
})
```

**Use 8B for:** file reads, grep, glob, diff generation, code explanation  
**Use 70B for:** architecture decisions, multi-file refactors, planning, user conversation

### 2.3 System Prompt Architecture
Two-zone system. Static zone is identical across all users (cache it). Dynamic zone is rebuilt per turn.

```
[STATIC — cached globally]
  You are Aurora, an AI OS agent. You have access to a terminal, 
  text editor, and web browser inside a desktop application built with Tauri.
  Your tools let you read/write files, run shell commands, search code,
  control the browser, and interact with all UI components via MCP.
  
  Rules: [tool usage rules, safety rules, output formatting]

[DYNAMIC_BOUNDARY]

[DYNAMIC — rebuilt every turn]
  ## Current Context
  - User: {userId}
  - Working Directory: {cwd}
  - Git Branch: {branch} | Status: {gitStatus}
  - Open File: {activeFile} (line {cursorLine}, col {cursorCol})
  - Active Diagnostics: {lspErrors}
  - Recent Terminal Output: {lastCommandOutput}
  
  ## User Preferences (from memory)
  {userMemoryBlock}
  
  ## Project Context
  {agentsMdContent}
```

---

## 3. Tool Suite (Complete)

### 3.1 Filesystem Tools

| Tool | Description | Permission Tier |
|------|-------------|----------------|
| `file_read` | Read file with optional line range | Auto |
| `file_write` | Write/overwrite file | Session-approve |
| `file_edit` | Surgical diff-based patch (prefer over write) | Session-approve |
| `file_create` | Create new file | Session-approve |
| `glob` | Find files by pattern (`**/*.ts`) | Auto |
| `directory_tree` | Recursive listing with .gitignore awareness | Auto |
| `file_delete` | Delete a file | Always-ask |

### 3.2 Search Tools

| Tool | Description | Permission Tier |
|------|-------------|----------------|
| `grep` | Ripgrep-backed regex search across project | Auto |
| `ast_search` | Tree-sitter: find functions, classes, imports | Auto |
| `symbol_lookup` | LSP workspace symbol search | Auto |

> **Note:** Do NOT implement RAG/vector indexing. Anthropic benchmarked this and switched to grep-based search — no index sync required, no embedding cost, no security surface.

### 3.3 Execution Tools

| Tool | Description | Permission Tier |
|------|-------------|----------------|
| `bash` | Shell command (timeout, CWD, env, stdout/stderr) | Always-ask |
| `bash_safe` | Whitelisted read-only commands (ls, cat, echo) | Session-approve |
| `lsp_hover` | Get type/doc at position | Auto |
| `lsp_goto_definition` | Jump to definition | Auto |
| `lsp_references` | Find all references | Auto |
| `lsp_diagnostics` | Get current errors/warnings | Auto |

### 3.4 Browser Tools (MCP-controlled)

| Tool | Description | Permission Tier |
|------|-------------|----------------|
| `browser_navigate` | Navigate to URL | Session-approve |
| `browser_screenshot` | Capture current page as image | Auto |
| `browser_dom_snapshot` | Get accessibility/DOM tree | Auto |
| `browser_click` | Click element by selector or coordinates | Session-approve |
| `browser_type` | Type into focused element | Session-approve |
| `browser_scroll` | Scroll by amount or to element | Auto |
| `browser_execute_js` | Run JS in browser context | Always-ask |
| `browser_extract` | Extract structured data from page | Auto |

### 3.5 UI Control Tools (Aurora MCP Bridge)

| Tool | Description | Permission Tier |
|------|-------------|----------------|
| `ui_open_file` | Open a file in the editor | Auto |
| `ui_focus_terminal` | Focus the terminal window | Auto |
| `ui_run_command` | Run command in the terminal | Session-approve |
| `ui_open_tab` | Open a new tab (terminal/editor/browser) | Auto |
| `ui_close_tab` | Close a tab | Session-approve |
| `ui_split_pane` | Split the current pane | Auto |
| `ui_set_editor_cursor` | Move cursor to line/col in editor | Auto |
| `ui_show_diff` | Show a diff view in editor | Auto |
| `ui_notify` | Show a notification toast | Auto |
| `ui_request_approval` | Request user approval before proceeding | Auto |

### 3.6 Git Tools

| Tool | Description | Permission Tier |
|------|-------------|----------------|
| `git_status` | Working tree status | Auto |
| `git_diff` | Show diff (staged, unstaged, or for file) | Auto |
| `git_log` | Recent commits | Auto |
| `git_blame` | Show blame for a file | Auto |
| `git_commit` | Create a commit | Always-ask |
| `git_checkout` | Checkout branch | Always-ask |
| `git_push` | Push to remote | Always-ask |

### 3.7 Agent/Orchestration Tools

| Tool | Description | Permission Tier |
|------|-------------|----------------|
| `todo_write` | Write/update a task list for this session | Auto |
| `todo_read` | Read current task list | Auto |
| `spawn_subagent` | Spawn isolated sub-agent for parallel work | Auto |
| `web_search` | Search the web | Auto |
| `web_fetch` | Fetch a specific URL | Auto |

---

## 4. MCP Bridge — Agent Controls the UI (Tauri)

This is the killer feature of aurora-term as an AI OS. The agent doesn't just write code — it controls every panel, tab, and UI component in the application.

### 4.1 Architecture

```
┌──────────────────────────────────────────┐
│        Mastra Agent (sidecar)            │
│   calls MCP tool: ui_open_file(path)     │
└───────────────┬──────────────────────────┘
                │ stdio MCP protocol
                ▼
┌──────────────────────────────────────────┐
│      Aurora MCP Server (Node.js)         │
│   translates MCP → IPC command           │
└───────────────┬──────────────────────────┘
                │ IPC Socket / WebSocket :9223
                ▼
┌──────────────────────────────────────────┐
│       Rust Plugin (Tauri v2)             │
│   tauri-plugin-aurora-mcp-bridge         │
│   receives command, emits Tauri event    │
└───────────────┬──────────────────────────┘
                │ Tauri IPC event
                ▼
┌──────────────────────────────────────────┐
│       React Frontend                     │
│   receives event, updates UI state       │
│   e.g., opens file in Monaco editor      │
└──────────────────────────────────────────┘
```

### 4.2 Implementation Plan

1. **Write `tauri-plugin-aurora-mcp-bridge`** (Rust crate):
   - Opens a Unix domain socket (IPC on macOS/Linux) or TCP socket (Windows / cross-platform)
   - Parses JSON commands from the MCP server
   - Emits `aurora://ui-command` Tauri events to the frontend
   - Captures screenshots via native APIs (no Screen Recording permission needed on macOS using `screencapture -l <CGWindowID>`)
   - Executes JS in webview windows via `window.eval()` or `tauri::WebviewWindow::eval()`

2. **Write Aurora MCP Server** (TypeScript, Node.js):
   - Exposes all `ui_*` and `browser_*` tools via MCP protocol (stdio)
   - Translates tool calls into socket commands to the Rust plugin
   - Returns tool results (screenshots as base64, DOM snapshots as JSON)
   - This server is the Mastra sidecar's local MCP server

3. **Frontend event bus** (React):
   - `listen('aurora://ui-command', handler)` on mount
   - Dispatch to correct panel (editor, terminal, browser) based on command type
   - All UI state mutations go through Zustand/Jotai so the agent sees consistent state

### 4.3 Production Build Note
The Tauri MCP plugin **should NOT be debug-only** (`#[cfg(debug_assertions)]`) for aurora-term — it IS the product. Use auth token validation on the socket connection so only the bundled sidecar can connect. The sidecar gets the token from an env var injected at app startup by the Rust core.

```rust
// In production: auth token, not debug-only
builder.plugin(
  tauri_plugin_aurora_mcp_bridge::init_with_config(
    PluginConfig::new("aurora")
      .start_socket_server(true)
      .socket_path("/tmp/aurora-mcp.sock")
      .auth_token(generate_session_token()) // random per-launch token
  )
)
```

---

## 5. Context Management

### 5.1 Four-Layer Compression

```
Context budget: ~30K tokens for Groq (conservative, leaves room for output)

Layer 1 — Snip:        Drop oldest tool results first (already acted on)
Layer 2 — Microcompact: Summarize a single old turn into 2-3 sentences
Layer 3 — Collapse:    Merge 5+ old turns into a paragraph summary block
Layer 4 — Autocompact: When >80% budget used — full session summary injected
                        as a new system message, history cleared
```

Trigger compression proactively, not reactively. Monitor token count on every response via `x-ratelimit-remaining-tokens`. At 50% used → start Layer 1. At 70% → Layer 2. At 85% → Layer 3/4.

### 5.2 Per-Turn Dynamic Context Injection

Every agent turn, inject fresh:
- Active file content (current function/class only, not whole file — chunk at AST boundaries)
- CWD, git status, git branch
- Last 20 lines of terminal output
- LSP diagnostics for the active file
- Any `@mention`ed files the user explicitly included

### 5.3 Token Slot Reservation
Default output cap: 2K tokens. Escalate to 8K if the agent's first tokens indicate a long response (detected by streaming prefix). This saves context budget in 90%+ of requests.

---

## 6. Permission & Safety Model

### 6.1 Permission Tiers

```
TIER 0 — BLOCKED (never execute, ever):
  rm -rf / · chmod 777 · Any write to ~/.ssh · curl | sh · sudo rm
  Writing outside the active project directory
  
TIER 1 — AUTO (execute immediately, log only):
  All read-only tools: file_read, grep, glob, git_status, lsp_*, directory_tree (excluding reading env variables and hidden files)
  Informational UI actions: ui_focus, ui_notify, ui_set_cursor
  
TIER 2 — SESSION-APPROVE (ask once, remember for session):
  File writes within the project dir
  Running non-destructive bash commands (npm install, cargo build)
  Browser navigation, browser_click
  
TIER 3 — ALWAYS-ASK (ask every time, show preview):
  git_commit, git_push, git_checkout
  bash commands with pipes, redirects, or sudo
  file_delete
  browser_execute_js
  Any action outside the project directory
  Reading env variables and hidden files (e.g. .env, .git/config, etc.)
```

### 6.2 The Permission UI
When the agent requests a Tier 2/3 action, pause the stream and surface:

```
┌─────────────────────────────────────────────┐
│ ⚠️  Aurora wants to run a command           │
│                                             │
│  $ npm install --save-dev typescript        │
│  in: ~/projects/better-forms               │
│                                             │
│  [Allow once]  [Allow for session]  [Deny]  │
└─────────────────────────────────────────────┘
```

For file writes, show a diff preview before executing `file_write` or `file_edit`.

### 6.3 Sandbox: The Execution Boundary

Aurora-term is a desktop app — you cannot use containers per-run. Instead:

**Layer 1 — Path Validation (Rust):**
Every file operation validates that the resolved absolute path (after symlink resolution) is inside the allowed project root. No path traversal (`../../../etc/passwd`) can slip through.

**Layer 2 — Command Allowlist/Blocklist:**
Before every `bash` execution, run the command string through a parser:
- Block: `rm -rf`, `sudo`, `curl | sh`, `wget | sh`, `eval`, `>>/etc/`
- Warn: pipes, redirects, background processes (`&`)
- Auto-approve: `ls`, `cat`, `echo`, `git status`, `npm list`, build commands

**Layer 3 — Environment Isolation:**
Strip sensitive env vars before injecting into the bash execution context: `AWS_*`, `GITHUB_TOKEN`, `SSH_*`, `*_SECRET`, `*_KEY`, `*_PASSWORD`. Never let the agent see credentials even if they're in the user's shell environment.

**Layer 4 — Resource Limits:**
Set process timeouts (30s default, 5min for build commands). Kill processes that exceed CPU/memory thresholds. Use Tauri's `Command` API with explicit timeout wrappers.

**Layer 5 — Tauri CSP:**
```json
"csp": {
  "default-src": "'self' ipc: http://ipc.localhost",
  "connect-src": "ipc: http://ipc.localhost https://api.groq.com",
  "script-src": "'self'",
  "img-src": "'self' data: blob:"
}
```
This blocks the browser webview from loading external scripts that could compromise the Tauri API.

**Layer 6 — Prompt Injection Defense:**
- Strip HTML/markdown from file contents before injecting into context (or clearly delimit with XML tags: `<file_content>...</file_content>`)
- Never let user-supplied text appear in the system prompt without sanitization
- Validate tool call arguments against Zod schemas before execution — never eval unsanitized strings

---

## 7. Memory System

### 7.1 Four Memory Tiers

**Tier 1 — In-Context (Mastra thread)**
- Conversation history for the current session
- Scoped to `threadId` — one per user per workspace
- Automatically managed by Mastra's storage backend (LibSQL/SQLite)
- Expires: keep last 50 turns, summarize older ones

**Tier 2 — Project Memory (AGENTS.md)**
- Lives at `{project_root}/.aurora/AGENTS.md`
- Read at session start, injected into system prompt
- User editable — this is their way of giving the agent standing instructions
- Example content: "This project uses Bun, not Node. Tests are in `src/__tests__`. Never modify `src/generated/`."
- Agent can propose updates to AGENTS.md but user must approve

**Tier 3 — Codebase Index (Tree-sitter)**
- Build an AST index of every file in the project on workspace open
- Watch for file changes and incrementally update
- Used for fast symbol lookup, not fed raw to the model
- Exposed via `ast_search` tool — agent queries the index rather than reading all files
- Storage: SQLite table (`symbol`, `file`, `line`, `kind`)

**Tier 4 — Cross-Session Facts (User Memory)**
- Per-user key-value store in your backend DB
- Populated by a background memory agent that runs after each session
- Mastra Observational Memory handles this automatically if configured
- Example: {"preferred_lang": "TypeScript", "default_test_runner": "vitest", "timezone": "Asia/Kolkata"}
- Injected into the dynamic system prompt block on every session start

### 7.2 Memory Isolation
```
User A: threadId: usr_abc123_proj_xyz  →  DB row scoped to (user_id, project_id)
User B: threadId: usr_def456_proj_xyz  →  separate DB row, zero overlap
```

Never share a thread or memory block between users. Project memory (AGENTS.md) is shared if multiple users collaborate on the same repo — that's intentional.

---

## 8. Rate Limiting & Quota System

### 8.1 Server-Side Queue (Required for Free Tier)

```typescript
import PQueue from 'p-queue'

// Org-level Groq queue (shared across all users on your backend)
const groqQueue = new PQueue({
  intervalCap: 28,        // stay under 30 RPM with 2 buffer
  interval: 60_000,
  concurrency: 5
})

// Per-user daily budget
const userBudgets = new Map<string, { turns: number, tokens: number }>()

async function queuedAgentTurn(userId: string, messages: Message[]) {
  const budget = userBudgets.get(userId) ?? { turns: 0, tokens: 0 }
  
  if (budget.turns >= FREE_TIER_DAILY_TURNS) {
    throw new Error('DAILY_LIMIT_REACHED')
  }
  
  return groqQueue.add(async () => {
    const response = await groq.chat.completions.create({ ... })
    budget.turns++
    budget.tokens += response.usage.total_tokens
    userBudgets.set(userId, budget)
    return response
  })
}
```

### 8.2 Token Budget Strategy

| User Tier | Daily Turns | Model Cap | Context Limit |
|-----------|-------------|-----------|--------------|
| Free | 20 turns/day | Llama 8B only | 8K context |
| Pro | Unlimited | Llama 70B available | 32K context |
| Self-hosted (BYOK) | Unlimited | Any Groq model | Full context |

Show users their remaining daily budget in the UI. Offer "bring your own Groq key" for power users — this eliminates your rate limit cost entirely for that segment.

### 8.3 Headers to Track

```typescript
// After every Groq response, read:
const remaining = {
  requests: response.headers.get('x-ratelimit-remaining-requests'),
  tokens: response.headers.get('x-ratelimit-remaining-tokens'),
  resetRequests: response.headers.get('x-ratelimit-reset-requests'), // "7.66s"
  resetTokens: response.headers.get('x-ratelimit-reset-tokens'),
}

// If remaining tokens < 500, hold the next request until reset
```

---

## 9. Error Recovery & Resilience

### 9.1 Recovery Ladder

```
Tool failure:
  1. Retry once with exponential backoff (transient errors: network, timeout)
  2. On second failure: log the error, inject into context as tool_result
  3. On third identical failure: inject "stuck" signal, request user guidance

Token limit (413 / prompt_too_long):
  1. Auto-compact (Layer 4 compression)
  2. Retry the request with compacted context
  3. If still too long: ask user to start a new session with /compact

Model fallback:
  1. Primary: groq/llama-3.3-70b-versatile
  2. Fallback: groq/llama-3.1-70b-versatile
  3. Emergency: groq/llama-3.1-8b-instant
  Insert tombstone: "Previous tool call discarded due to model switch"
```

### 9.2 Loop Detection
If the agent calls the same tool with the same arguments 3 times in a row, surface an interrupt:
```
⚠️ Aurora appears to be stuck on: grep("TODO", "src/")
[Give hint]  [Skip this step]  [Abort]
```

### 9.3 Session Handoff
When context approaches the limit and autocompact would lose critical state, instead of silent compression:
1. Generate a structured session summary (task state, files modified, key decisions)
2. Save to `{project}/.aurora/sessions/{timestamp}.json`
3. Offer the user a "continue session" button on next launch that reinjects the summary

---

## 10. The Browser (WebView MCP)

Aurora's browser is a Tauri WebView window. The agent controls it via MCP browser tools.

### 10.1 Browser Agent Capabilities
- Navigate to any URL
- Take a screenshot and return it as base64 (vision — send to model as image input)
- Extract DOM snapshot (accessibility tree — cheaper than screenshot for text content)
- Click elements by CSS selector, text content, or coordinates
- Fill forms
- Execute JavaScript (gated behind Always-ask permission)
- Extract structured data from pages (invoke a dedicated extraction sub-agent)

### 10.2 Browser Security
- The browser WebView runs in a **separate Tauri window** with its own CSP
- Block `file://` access from browser WebView (prevent localhost exfil)
- The agent can only send browser commands through the MCP bridge — it cannot access the user's stored browser cookies/sessions
- Never inject the agent into a banking or auth session — detect sensitive domains and block scripted interaction

### 10.3 Vision Loop
```
agent → browser_screenshot → base64 image
      → send to model as image content block
      → model describes what it sees
      → agent issues next browser action
```
This is how the agent navigates complex web UIs without needing full DOM access.

---

## 11. Observability & Evals

Every agent run should emit structured telemetry:

```typescript
interface AgentRunTrace {
  sessionId: string
  userId: string
  turnId: string
  model: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  toolCalls: Array<{ tool: string, durationMs: number, success: boolean }>
  compressionApplied: boolean
  permissionsRequested: Array<{ tier: 1 | 2 | 3, approved: boolean }>
  errorCount: number
}
```

Store in SQLite locally (acessible in Mastra Studio). Forward to PostHog or your own analytics for production. Use this data to:
- Identify which tools fail most (fix them)
- Find prompts that cause loops (fix the system prompt)
- See which users are hitting rate limits (upgrade their tier or improve compression)
- Benchmark model choice: does 8B solve this class of task well enough?

---

## 12. Security Checklist — Where to Add Checks

### At Tool Invocation (Rust)
- [ ] Path canonicalization and boundary check before any file operation
- [ ] Command string validation before bash execution
- [ ] Strip sensitive env vars from bash execution environment
- [ ] Auth token validation on MCP socket connection
- [x] Rate check: is this user within their quota?

### At Context Assembly (TypeScript)
- [x] Sanitize file content before injecting into prompt (XML-delimit, strip `</file_content>` injection attempts)
- [x] Validate all tool arguments against Zod schemas
- [ ] Ensure no user A data appears in user B's context

### At API Boundary (TypeScript)
- [ ] JWT validation on all API routes
- [ ] Input size limits (max prompt length per request)
- [ ] Output validation: reject tool calls that target blocked paths/commands

### At Frontend (React)
- [ ] CSP headers on all served content
- [ ] Never eval() agent-generated code in the frontend context
- [ ] Sanitize any agent-generated HTML before rendering (use DOMPurify)

### At Tauri Level (Rust)
- [ ] Capability-based permissions — only grant what each window needs
- [ ] Deny webview data directory access
- [ ] IPC message validation in Tauri commands (never trust frontend input)
- [ ] Code-sign the production binary

---

## 13. Launch Checklist — Free Tier

- [ ] Rate limit queue implemented server-side (not client-side)
- [ ] Per-user daily budget enforced and surfaced in UI
- [ ] "Bring your own Groq key" option implemented
- [x] Memory is per-user (threadId isolation verified)
- [ ] Sensitive env vars stripped from bash execution
- [ ] Diff preview before all file writes
- [ ] Permission tier system implemented
- [ ] Loop detection active
- [ ] Session traces stored for debugging
- [ ] Groq RPD counter tracked (not just RPM/TPM)
- [x] Error states handled gracefully (no raw 429s shown to users)
- [ ] AGENTS.md created on workspace open if missing
- [ ] Autocompact triggers before context limit, not after

---