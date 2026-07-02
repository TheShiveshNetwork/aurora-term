import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDescription } from './helper';

export const webFetchTool = createTool({
  id: 'web_fetch',
  description: getDescription('webfetch.txt', 'Fetch and clean public URL content.'),
  inputSchema: z.object({
    url: z.string().describe('The HTTP/HTTPS URL to fetch content from.'),
    format: z.enum(['text', 'markdown', 'html']).optional().default('markdown').describe('Format to return content in.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    content: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ url, format }) => {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, error: 'URL must start with http:// or https://' };
    }
    try {
      const response = await fetch(url, { headers: { 'Accept': 'text/html,text/plain,application/xhtml+xml' } });
      if (!response.ok) {
        return { success: false, error: `HTTP error! status: ${response.status}` };
      }
      const html = await response.text();
      if (format === 'html') {
        return { success: true, content: html };
      }
      
      let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      
      if (format === 'markdown') {
        text = text.replace(/<h[1-6]\b[^>]*>(.*?)<\/h[1-6]>/gi, '\n\n# $1\n\n');
        text = text.replace(/<p\b[^>]*>(.*?)<\/p>/gi, '\n\n$1\n\n');
        text = text.replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
      }
      
      text = text.replace(/<[^>]+>/g, '');
      text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      
      return { success: true, content: text.replace(/\n\s*\n\s*\n/g, '\n\n').trim() };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  },
});
