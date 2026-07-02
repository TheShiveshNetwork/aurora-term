import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDescription } from './helper';

export const execCommandTool = createTool({
  id: 'exec_command',
  description: getDescription('command.txt', 'Execute a shell command sequentially in the terminal queue.'),
  inputSchema: z.object({
    command: z.string().describe('The command line string to run.'),
    explanation: z.string().describe('Brief explanation of what this command accomplishes.'),
  }),
  suspendSchema: z.object({
    command: z.string(),
    explanation: z.string(),
    type: z.literal('command'),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const { resumeData, suspend } = context?.agent ?? {};

    // Command execution always goes to the client queue, so we ALWAYS suspend
    // to let the frontend run it in the terminal tab PTY!
    if (!resumeData) {
      return suspend?.({
        command: input.command,
        explanation: input.explanation,
        type: 'command' as const,
      });
    }

    if (!resumeData.approved) {
      return { success: false, error: 'User rejected or cancelled command execution.' };
    }

    return {
      success: resumeData.exitCode === 0,
      stdout: resumeData.stdout,
      stderr: resumeData.stderr,
      exitCode: resumeData.exitCode,
    };
  },
});
