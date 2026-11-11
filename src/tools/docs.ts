import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { askVapiDocs } from '../knowledge/docs.js';
import { readOnly } from './annotations.js';

async function knowledgeResult(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `Knowledge request failed: ${error instanceof Error ? error.message : 'Unknown upstream error'}` }] };
  }
}

export function registerDocsTools(server: McpServer) {
  server.registerTool('ask_vapi_docs', {
    description: 'Ask about current Vapi documentation through the Fern docs MCP. Returns relevant documentation passages and source URLs; use them to answer the question.',
    inputSchema: {
      question: z.string().trim().min(1).max(4000).describe('A specific question about Vapi configuration, APIs, SDKs or troubleshooting. Send no API keys or private customer data.'),
      topK: z.number().int().min(1).max(20).default(8).describe('Maximum number of relevant documentation passages.'),
    }, annotations: readOnly('Ask Vapi Docs', true),
  }, ({ question, topK }, extra) => knowledgeResult(async () => {
    const result = await askVapiDocs(question, topK, extra.signal);
    // The upstream SDK also types legacy toolResult responses. Fern uses the
    // normal content form, which is the only form this wrapper advertises.
    if (!('content' in result)) throw new Error('Unexpected response from the Vapi docs MCP.');
    return result as CallToolResult;
  }));
}
