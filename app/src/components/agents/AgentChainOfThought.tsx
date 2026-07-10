import {
  Lightbulb,
  Terminal,
  Users,
  CircleCheck,
  CircleAlert,
  Loader2,
} from "lucide-react";
import type { ChainNode } from "../../stores/useAgentStore";
import {
  ChainOfThought,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtCommand,
} from "../prompt-kit/chain-of-thought";

const NODE_ICONS: Record<ChainNode["type"], React.ComponentType<{ className?: string }>> = {
  planning: Lightbulb,
  command: Terminal,
  subagent: Users,
  complete: CircleCheck,
  error: CircleAlert,
};

export interface AgentChainOfThoughtProps {
  nodes: ChainNode[];
  activeNodeId?: string | null;
  className?: string;
}

export function AgentChainOfThought({
  nodes,
  activeNodeId,
  className,
}: AgentChainOfThoughtProps) {
  if (nodes.length === 0) return null;

  return (
    <ChainOfThought className={className}>
      {nodes.map((node) => {
        const isActive = node.status === "active";
        const Icon = NODE_ICONS[node.type];

        return (
          <ChainOfThoughtStep key={node.id} defaultOpen={isActive}>
            <ChainOfThoughtTrigger
              leftIcon={
                isActive ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Icon className="size-4" />
                )
              }
            >
              {node.label}
              {node.subagent && (
                <span className="text-on-surface-variant/40 ml-1">
                  ({node.subagent})
                </span>
              )}
            </ChainOfThoughtTrigger>
            {(node.subLabel || (node.command && node.command !== node.label)) && (
              <ChainOfThoughtContent>
                <ChainOfThoughtItem>
                  {node.subLabel}
                  {node.command && node.command !== node.label && (
                    <ChainOfThoughtCommand>{node.command}</ChainOfThoughtCommand>
                  )}
                </ChainOfThoughtItem>
              </ChainOfThoughtContent>
            )}
          </ChainOfThoughtStep>
        );
      })}
    </ChainOfThought>
  );
}
