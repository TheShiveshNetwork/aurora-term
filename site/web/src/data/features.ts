import type { ComponentType } from "react";
import {
  Blocks,
  Bot,
  Cloud,
  Cpu,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

export interface Feature {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  description: string;
}

export const features: Feature[] = [
  {
    icon: Cpu,
    title: "Hardware-accelerated terminal",
    description:
      "Output blocks render through the GPU with the WebGL xterm renderer. Scrolling thousands of lines stays at 60fps, even on huge recursive listings.",
  },
  {
    icon: Bot,
    title: "Local agent sidecar",
    description:
      "A native, single-file agent binary runs next to Aurora. It plans multi-step tasks, runs commands in your terminals, and self-corrects when output is truncated.",
  },
  {
    icon: Sparkles,
    title: "Multi-provider AI routing",
    description:
      "Fast, Balanced, and Powerful task tiers route across Anthropic, OpenAI, Gemini, NVIDIA NIM, and local Ollama. API keys live in the OS keychain — never in config files.",
  },
  {
    icon: Blocks,
    title: "GPU-rendered output blocks",
    description:
      "Every command becomes a block with its exit code, duration, and output type. Big results are summarized with a head+tail digest so the agent stays in context.",
  },
  {
    icon: Cloud,
    title: "Cloud settings sync",
    description:
      "Sign in with GitHub, Google, or email and your aurora.json settings follow you across machines. Last-write-wins with a 3-way merge dialog when conflicts occur.",
  },
  {
    icon: TerminalSquare,
    title: "AI-native editor",
    description:
      "CodeMirror with inline AI edits and ghost-text completion. Select code, hit Ctrl+L, and let the agent rewrite it inline with accept/reject.",
  },
];
