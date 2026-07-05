# Plan: Agent Output Architecture (Smart Truncation & Self-Correction)

## Problem
When `Get-ChildItem -Recurse` produces 150K+ chars, the LLM's context fills with raw text. It can't see the goal, previous commands, or that the command succeeded → keeps repeating the same command.

## Changes

### 1. `app/src/hooks/useAgentExecution.ts` — `truncateOutput()`
- Replace current simple slice with **head + tail + directive**:
  ```
  [Output truncated: 150,000 characters total]

  First 200 characters:
  <first 200 chars>

  Last 200 characters:
  <last 200 chars>
  ```
- Constant: `HEAD_TAIL_CHARS = 200`

### 2. `packages/aurora-agent/src/agents/aura.ts` — Terminal Agent Prompt
- Add **OUTPUT HANDLING** section to `terminalAgent.instructions`:
  ```
  OUTPUT HANDLING:
  - Command output larger than 4,000 chars is truncated with a summary.
    Focus on the last 200 characters — they contain the most recent results.
  - If your output says "[Output truncated...]", do NOT repeat the same command.
    Instead, propose a more targeted command (grep, Select-String, find).
  - You can chain: list files → if too many results → grep for the specific term.
  ```

### No changes needed
- `approveAndRunPending` (line 485) — automatically gets truncated output from `waitForBlockCompletion`
- `executeNextStep` — also gets truncated output from `waitForBlockCompletion`
- Duplicate auto-skip (lines 120-148) — stays as secondary safety net

## Verification
1. `pnpm typecheck` (app)
2. `cargo clippy --workspace -- -D warnings` (Rust)
3. Manual: agent task with `Get-ChildItem -Recurse` — should self-correct to grep

## Order
1. Edit `useAgentExecution.ts` (truncateOutput)
2. Edit `aura.ts` (prompt)
