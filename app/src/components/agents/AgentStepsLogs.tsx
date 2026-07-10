import type { AgentLog } from "../../stores/useAgentStore";
import {
  Steps,
  StepsTrigger,
  StepsContent,
  StepsItem,
  StepsCountBadge,
} from "../prompt-kit/steps";

export interface AgentStepsLogsProps {
  logs: AgentLog[];
  className?: string;
}

export function AgentStepsLogs({ logs, className }: AgentStepsLogsProps) {
  if (logs.length === 0) return null;

  return (
    <Steps className={className}>
      <StepsTrigger>
        <StepsCountBadge count={logs.length} />
        <span>Execution Logs</span>
      </StepsTrigger>
      <StepsContent>
        {logs.map((log, i) => (
          <StepsItem key={i}>
            <span className="text-on-surface-variant/25 mr-1.5">
              [{new Date(log.timestamp).toLocaleTimeString()}]
            </span>
            <span>{log.content}</span>
          </StepsItem>
        ))}
      </StepsContent>
    </Steps>
  );
}
