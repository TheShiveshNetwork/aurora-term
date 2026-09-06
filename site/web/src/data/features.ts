import type { ComponentType } from "react";
import {
  Blocks,
  Bot,
  Cloud,
  FolderOpen,
  GitGraph,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

export interface Feature {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  description: string;
  className?: string;
}

export const features: Feature[] = [
  {
    icon: ShieldCheck,
    title: "An Agent That Asks First",
    description:
      "Give it the goal. Keep the final say. Ask Aurora to handle a task in plain English. It plans the work, executes it step by step, and pauses when something needs your approval. Nothing important happens behind your back.",
    className: "md:row-span-2",
  },
  {
    icon: Bot,
    title: "Local AI agent",
    description:
      "A native, single-file agent binary runs entirely on your machine — no cloud round-trip for the decisions that matter. It plans multi-step tasks, runs commands in your terminals, and self-corrects when output is truncated.",
  },
  {
    icon: GitGraph,
    title: "Visual Git Studio",
    description:
      "Your repository, without the archaeology. Browse commits, branches, staged changes, unstaged changes, and the full commit graph in a visual interface built into Aurora.",
    className: "md:col-span-2",
  },
  {
    icon: FolderOpen,
    title: "Files, Right Inside the Terminal",
    description:
      "See what your commands created. New files and folders appear in the terminal the moment they happen — no file manager needed.",
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
];