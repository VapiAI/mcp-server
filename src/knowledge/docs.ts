import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export const DOCS_MCP_URL = 'https://docs.vapi.ai/_mcp/server';

// A separate connection per request avoids sharing a failed session or leaking
// concurrent calls across each other. No Vapi credentials are sent upstream.
export async function askVapiDocs(
  question: string,
  topK: number,
  signal?: AbortSignal,
  transport: Transport = new StreamableHTTPClientTransport(new URL(DOCS_MCP_URL))
) {
  const client = new Client({ name: 'vapi-mcp-docs', version: '1.0.0' });
  const options = { signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]), timeout: 30_000 };
  try {
    await client.connect(transport, options);
    return await client.callTool({ name: 'searchDocs', arguments: { query: question, topK } }, undefined, options);
  } finally {
    await client.close().catch(() => undefined);
  }
}
