# Aurora Agent — Model Reference

Reference for AI models used in `packages/aurora-agent`. Read this before changing any `getModelProvider()` call or writing model-specific tests.

---

## Active Default Model: `llama-3.3-70b-versatile` (Groq)

| Property | Value |
|---|---|
| **Provider** | Groq |
| **Model ID** | `llama-3.3-70b-versatile` |
| **Context window** | **128,000 tokens** |
| **Tool calling** | Standard OpenAI JSON function calling |
| **Status** | Active |

---

## Root Cause of Tool Call Failures — Working Memory XML Tags

### The bug

Mastra's Memory system with `workingMemory: { enabled: true }` injects XML-tagged content into the agent system prompt:

`xml
<working_memory>
# User Profile
- **Name**: ...
</working_memory>
`

Llama models (llama-3.1, llama-3.3, and others) interpret XML tags in the context as a signal to use XML-style output. Instead of the standard OpenAI JSON function calling format, they generate:

`
<function=shell_terminal={"command": "Get-ChildItem", "timeout": 120000}>
`

This causes two different errors depending on the model:
- `llama-3.3-70b-versatile`: Groq API rejects it (HTTP 400, `tool_use_failed`)
- `llama3-groq-70b-8192-tool-use-preview`: Groq accepts it but parses the tool name as `shell_terminal={"command":...}` — Mastra validation then fails

### The fix

Working memory is DISABLED in `auraMemory`:

`	ypescript
workingMemory: {
  enabled: false,  // DO NOT re-enable without switching to a non-Llama model
}
`

Do NOT re-enable working memory unless:
1. You are using a model that handles XML in context correctly (Anthropic Claude, OpenAI GPT-4o, Google Gemini), OR
2. You configure Mastra to use a non-XML working memory format

### Why tests pass but production fails

Tests call `tool.execute()` directly — the model is never invoked. The XML hallucination is a runtime-only failure that cannot be caught by the unit test suite. To test model behaviour, use the sidecar directly:

`powershell
pnpm --dir packages/aurora-agent dev

curl -X POST http://localhost:4096/api/step `
  -H "Content-Type: application/json" `
  -d '{\"task_id\":\"test-1\",\"goal\":\"list files in current directory\",\"agent_type\":\"terminal\",\"mode\":\"build\"}'
`

A correct response has `"status": "requires_approval"` and a `shell_terminal` tool call.

---

## Model Tier Mapping (Groq)

| Tier | Env var | Default model | Context |
|---|---|---|---|
| `fast` | `ACTIVE_AI_MODEL_FAST` | `llama-3.3-70b-versatile` | 128k |
| `balanced` | `ACTIVE_AI_MODEL_BALANCED` | `llama-3.3-70b-versatile` | 128k |
| `powerful` | `ACTIVE_AI_MODEL_POWERFUL` | `llama-3.3-70b-versatile` | 128k |

Override via env vars in `.env` or the Aurora Settings UI.

---

## Switching Providers

Set `ACTIVE_AI_PROVIDER` in `packages/aurora-agent/.env` (dev) or Aurora Settings UI (Tauri sidecar):

`env
ACTIVE_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
`

Provider recommendations for tool calling (best to acceptable):
1. **Anthropic Claude** — Most reliable, no XML confusion, large context
2. **OpenAI GPT-4o** — Excellent structured tool support
3. **Google Gemini** — Good tool support, very large context
4. **Groq llama-3.3-70b-versatile** — Fast, works when working memory is OFF

> WARNING: If you switch back to a Llama-based provider, keep `workingMemory: { enabled: false }` or you will get XML tool call errors again.
