import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { askVapiDocs } from '../knowledge/docs.js';
import { registerDocsTools } from '../tools/docs.js';

afterEach(() => { jest.restoreAllMocks(); });

test('discovers offline, rejects invalid docs inputs before dispatch and returns upstream failures as tool errors', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Docs service unavailable'));
  const server = new McpServer({ name: 'docs-fixture', version: '0' });
  registerDocsTools(server);
  const client = new Client({ name: 'docs-client', version: '0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(['ask_vapi_docs']);
    expect(tools[0].annotations?.readOnlyHint).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    for (const args of [{ question: '   ' }, { question: 'Question', topK: 21 }]) {
      expect((await client.callTool({ name: 'ask_vapi_docs', arguments: args })).isError).toBe(true);
    }
    expect(fetcher).not.toHaveBeenCalled();
    const failure = await client.callTool({ name: 'ask_vapi_docs', arguments: { question: 'What is Vapi?' } });
    expect(failure.isError).toBe(true);
    expect(failure.content).toEqual([{ type: 'text', text: expect.stringContaining('Docs service unavailable') }]);
  } finally {
    await client.close();
    await server.close();
  }
});

describe('Fern docs MCP proxy', () => {
  test('uses the real HTTP handshake, defaults topK and sends no credentials to Fern', async () => {
    // Adapted from the remote-server prototype's wire check. Exercise the
    // outer registered tool as well as the actual upstream SDK transport.
    const messages: { method: string; params?: unknown }[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://docs.vapi.ai/_mcp/server');
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      const message = JSON.parse(String(init?.body));
      messages.push(message);
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fern', version: '1' } }
        : { content: [{ type: 'text', text: 'Source: https://docs.vapi.ai/assistants/hooks' }] };
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    });
    const server = new McpServer({ name: 'proxy-test', version: '0' });
    registerDocsTools(server);
    const client = new Client({ name: 'proxy-client', version: '0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
      const result = await client.callTool({ name: 'ask_vapi_docs', arguments: { question: 'How do hooks work?' } });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: 'Source: https://docs.vapi.ai/assistants/hooks' }]);
      expect(messages.map(message => message.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
      expect(messages[2].params).toEqual({ name: 'searchDocs', arguments: { query: 'How do hooks work?', topK: 8 } });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test.each([false, true])('maps question to query and preserves content, sources, structured content and upstream isError=%s', async isError => {
    const upstream = new McpServer({ name: 'fern-fixture', version: '0' });
    const response = {
      content: [
        { type: 'text' as const, text: 'Hook guidance: https://docs.vapi.ai/assistants/hooks' },
        { type: 'resource_link' as const, name: 'Hooks', uri: 'https://docs.vapi.ai/assistants/hooks' },
      ],
      structuredContent: { passages: ['hook guidance'] }, isError,
    };
    const handler = jest.fn(async (_args: { query: string; topK: number }) => response);
    upstream.registerTool('searchDocs', { inputSchema: { query: z.string(), topK: z.number().int() } }, handler);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await upstream.connect(serverTransport);
    const close = jest.spyOn(clientTransport, 'close');
    try {
      expect(await askVapiDocs('How do hooks work?', 3, undefined, clientTransport)).toEqual(response);
      expect(handler.mock.calls[0][0]).toEqual({ query: 'How do hooks work?', topK: 3 });
      expect(close).toHaveBeenCalled();
    } finally {
      await upstream.close();
    }
  });

  test('closes the upstream connection on failure and cancellation', async () => {
    const upstream = new McpServer({ name: 'fern-fixture', version: '0' });
    const controller = new AbortController();
    upstream.registerTool('searchDocs', { inputSchema: { query: z.string(), topK: z.number() } }, async () => {
      controller.abort();
      return { content: [{ type: 'text', text: 'too late' }] };
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await upstream.connect(serverTransport);
    const close = jest.spyOn(clientTransport, 'close');
    try {
      await expect(askVapiDocs('Question', 8, controller.signal, clientTransport)).rejects.toThrow();
      expect(close).toHaveBeenCalled();
    } finally {
      await upstream.close();
    }
  });
});
