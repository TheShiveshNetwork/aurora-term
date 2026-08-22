import { system, AgentSkillsResult, AgentMcpResult, AgentMcpInfo } from "./ipc";

export interface SlashOutcome {
  handled: boolean;
  assistantMessage?: string;
  goal?: string;
}

function formatSkillsListing(res: AgentSkillsResult): string {
  const project = res.project.map(
    (s) => `  ${s.name}  —  ${s.path}${s.description ? `  (${s.description})` : ""}`
  );
  const global = res.global.map(
    (s) => `  ${s.name}  —  ${s.path}${s.description ? `  (${s.description})` : ""}`
  );
  return (
    `**Skills (${res.total} total)**\n\nProject:\n${project.length ? project.join("\n") : "  none"}` +
    `\n\nGlobal:\n${global.length ? global.join("\n") : "  none"}`
  );
}

function formatMcpListing(res: AgentMcpResult): string {
  const fmt = (m: AgentMcpInfo) => {
    const cmd = m.command ? `  (cmd: ${m.command} ${(m.args || []).join(" ")})` : "";
    const url = m.url ? `  (url: ${m.url})` : "";
    return `  ${m.name}  —  ${m.type}${cmd}${url}`;
  };
  return (
    `**MCP servers (${res.total} total)**\n\nProject:\n${res.project.length ? res.project.map(fmt).join("\n") : "  none"}` +
    `\n\nGlobal:\n${res.global.length ? res.global.map(fmt).join("\n") : "  none"}`
  );
}

async function tryCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error("Slash command failed:", err);
    return null;
  }
}

export async function resolveSlashCommand(
  input: string,
  opts: { cwd?: string; sessionId?: string | null; model?: string; isTaskRunning?: boolean }
): Promise<SlashOutcome> {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "/skills" || lower.startsWith("/skills ")) {
    const res = await tryCall(() => system.agentSkills(opts.cwd));
    if (!res) {
      return { handled: true, assistantMessage: "Could not reach the agent sidecar. Check that it is running." };
    }
    if (res.status !== "ok") {
      return { handled: true, assistantMessage: "Failed to list skills." };
    }
    return { handled: true, assistantMessage: formatSkillsListing(res) };
  }

  if (lower === "/mcp" || lower.startsWith("/mcp ")) {
    const res = await tryCall(() => system.agentMcp(opts.cwd));
    if (!res) {
      return { handled: true, assistantMessage: "Could not reach the agent sidecar. Check that it is running." };
    }
    if (res.status !== "ok") {
      return { handled: true, assistantMessage: "Failed to list MCP servers." };
    }
    return { handled: true, assistantMessage: formatMcpListing(res) };
  }

  if (lower === "/btw" || lower.startsWith("/btw ")) {
    const msg = trimmed.slice("/btw".length).trim();
    if (!msg) {
      return { handled: true, assistantMessage: "Usage: /btw <message>" };
    }
    if (opts.isTaskRunning) {
      // Out-of-band: ask the side question while the task runs, without
      // touching the task thread's memory.
      const res = await tryCall(() => system.agentBtw(msg, opts.sessionId ?? undefined, opts.model));
      if (!res) {
        return { handled: true, assistantMessage: "Could not reach the agent sidecar. Check that it is running." };
      }
      if (res.status !== "completed") {
        return { handled: true, assistantMessage: res.message || "BTW request failed." };
      }
      return { handled: true, assistantMessage: res.message || "OK" };
    }
    // No task running → route the message into the chat as a normal goal.
    return { handled: true, goal: msg };
  }

  if (lower.startsWith("/file ")) {
    const tokens = trimmed
      .slice("/file ".length)
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) {
      return { handled: true, assistantMessage: "Usage: /file <path1> <path2> ..." };
    }

    // Leading tokens that look like paths are file paths; the first token that
    // does not (no separator, no extension) starts the goal message.
    const paths: string[] = [];
    let goalRest = "";
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const looksLikePath =
        tok.includes("\\") || tok.includes("/") || /\.[A-Za-z0-9]+$/.test(tok);
      if (looksLikePath) {
        paths.push(tok);
      } else {
        goalRest = tokens.slice(i).join(" ");
        break;
      }
    }
    if (paths.length === 0) {
      return { handled: true, assistantMessage: "Usage: /file <path1> <path2> ..." };
    }

    const res = await tryCall(() => system.agentFileContext(paths, opts.cwd));
    if (!res) {
      return { handled: true, assistantMessage: "Could not reach the agent sidecar. Check that it is running." };
    }
    if (res.status === "completed" && res.context) {
      const goal = goalRest
        ? `[FILE CONTEXT]\n${res.context}\n\n${goalRest}`
        : `[FILE CONTEXT]\n${res.context}\n\nReview these files and report what you find.`;
      return { handled: true, goal };
    }
    return { handled: true, assistantMessage: res.message || "Could not load file context." };
  }

  return { handled: false };
}
