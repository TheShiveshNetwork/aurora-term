import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDescription } from './helper';
import { rootLogger } from '../logger';

const toolLog = rootLogger.child({ tool: 'exec_command' });

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
      toolLog.info('Suspending — sending command to terminal queue', {
        command: input.command.slice(0, 200),
        explanation: input.explanation,
      });
      return suspend?.({
        command: input.command,
        explanation: input.explanation,
        type: 'command' as const,
      });
    }

    if (!resumeData.approved) {
      toolLog.warn('Command rejected by user', {
        command: input.command.slice(0, 200),
      });
      return { success: false, error: 'User rejected or cancelled command execution.' };
    }

    toolLog.info('Command result received', {
      command: input.command.slice(0, 200),
      exitCode: resumeData.exitCode,
      success: resumeData.exitCode === 0,
      stdoutLength: resumeData.stdout?.length,
      stderrLength: resumeData.stderr?.length,
    });
    toolLog.debug('Command stdout', { stdout: resumeData.stdout?.slice(0, 500) });
    toolLog.debug('Command stderr', { stderr: resumeData.stderr?.slice(0, 500) });

    return {
      success: resumeData.exitCode === 0,
      stdout: resumeData.stdout,
      stderr: resumeData.stderr,
      exitCode: resumeData.exitCode,
    };
  },
});
