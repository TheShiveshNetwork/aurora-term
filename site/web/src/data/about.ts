import type { ComponentType } from "react";
import { Blocks, Bot, ShieldCheck } from "lucide-react";

export interface StoryBlock {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  description: string;
}

export const aboutStory: StoryBlock[] = [
  {
    icon: ShieldCheck,
    title: "Approval before action",
    description:
      "Aurora plans multi-step tasks and asks before it acts — it never runs anything you didn't approve.",
  },
  {
    icon: Blocks,
    title: "Clean output blocks",
    description:
      "Every command is grouped into a clean block with its exit code, duration, and output type, so long sessions stay readable.",
  },
  {
    icon: Bot,
    title: "A local agent on standby",
    description:
      "A local AI agent lives right next to Aurora, ready to plan, self-correct, and keep you in control of every command.",
  },
];