import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDescription } from './helper';

export const askUserTool = createTool({
  id: 'ask_user',
  description: getDescription('ask_user.txt', 'Ask the user a clarifying question.'),
  inputSchema: z.object({
    question: z.string().describe('The question you want to ask the user.'),
  }),
  suspendSchema: z.object({
    question: z.string(),
    type: z.literal('question'),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    answer: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    answer: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const { resumeData, suspend } = context?.agent ?? {};
    if (!resumeData) {
      return suspend?.({
        question: input.question,
        type: 'question' as const,
      });
    }
    if (!resumeData.approved) {
      return { success: false, error: 'User declined to answer.' };
    }
    return { success: true, answer: resumeData.answer || '' };
  },
});
