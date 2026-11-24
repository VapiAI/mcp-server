import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { registerAssistantTools } from '../tools/assistant.js';
import { registerToolTools } from '../tools/tool.js';
import { parseToolResponse } from '../utils/response.js';
import { registerCallTools } from '../tools/call.js';
import { registerApiSchemaTools } from '../tools/api-schema.js';
import { withToolErrorHandling } from '../tools/utils.js';

const upstreamBody = JSON.stringify({
  message: 'synthetic error with customer-secret-123',
  customer: { phoneNumber: '+15555550199' },
});

describe('execution error semantics across the MCP and Vapi SDK boundary', () => {
  let baseUrl: string;
  let mcpServer: McpServer;
  let client: Client;
  let requests: Array<{ method: string | undefined; path: string | undefined }>;
  let nextResponse:
    | { status?: number; dropConnection?: boolean; timeout?: boolean; body?: string }
    | undefined;

  beforeAll(async () => {
    requests = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = new URL(String(input));
      requests.push({ method: init?.method, path: `${requestUrl.pathname}${requestUrl.search}` });
      const behavior = nextResponse;
      nextResponse = undefined;
      if (behavior?.timeout) {
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), { once: true });
        });
      }
      if (behavior?.dropConnection) {
        throw new TypeError('Authorization: Bearer SEEDED_SECRET');
      }
      const body = behavior?.status !== undefined && behavior.status >= 400
        ? behavior.body ?? upstreamBody
        : '[]';
      return new Response(body, {
        status: behavior?.status ?? 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-synthetic-123',
          'retry-after': '7',
        },
      });
    };
    baseUrl = 'https://api.vapi.test';

    const vapi = new VapiClient({
      token: 'synthetic-token',
      baseUrl,
      fetch,
      maxRetries: 0,
      timeoutInSeconds: 0.05,
    });
    mcpServer = new McpServer({ name: 'error-test-server', version: 'test' });
    registerCallTools(mcpServer, vapi);
    registerAssistantTools(mcpServer, vapi);
    registerToolTools(mcpServer, vapi);
    registerApiSchemaTools(mcpServer, vapi);
    mcpServer.registerTool('result_passthrough', { inputSchema: {} }, withToolErrorHandling((_args, extra) => ({
      content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
      structuredContent: { contextReceived: extra.signal instanceof AbortSignal },
      _meta: { fixture: true },
    })));
    mcpServer.registerTool('synchronous_failure', { inputSchema: {} }, withToolErrorHandling(() => {
      throw new Error('Authorization: Bearer SEEDED_SECRET');
    }, { tool: 'synchronous_failure' }));
    client = new Client({ name: 'error-test-client', version: 'test' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
  });

  const callTool = (params: { name: string; arguments: Record<string, unknown> }) =>
    client.callTool(params, undefined, { timeout: 1_000 });

  afterAll(async () => {
    await client.close();
    await mcpServer.close();
  });

  test.each<[number, string, string]>([
    [400, 'HTTP_BAD_REQUEST', 'Correct the request before trying again.'],
    [401, 'HTTP_UNAUTHORIZED', 'Check the Vapi credentials and authorize again.'],
    [403, 'HTTP_FORBIDDEN', 'Check that the credentials have permission for this operation.'],
    [404, 'HTTP_NOT_FOUND', 'Check the resource ID and connected account.'],
    [429, 'HTTP_RATE_LIMITED', 'Wait for the indicated retry delay before trying again.'],
    [503, 'HTTP_UPSTREAM_UNAVAILABLE', 'Retry the read later.'],
  ])('returns explicit %i failure semantics through the MCP client', async (status, code, recovery) => {
    nextResponse = { status };
    const before = requests.length;
    const result = await callTool({ name: 'list_calls', arguments: {} });

    expect(requests).toHaveLength(before + 1);
    expect(requests[before]).toEqual({ method: 'GET', path: '/call?limit=11' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: expect.objectContaining({
        source: 'vapi_api',
        code,
        status,
        tool: 'list_calls',
        outcome: 'failed',
        recovery,
      }),
    });
    expect(JSON.stringify(result)).not.toContain('customer-secret-123');
    expect(JSON.stringify(result)).not.toContain('+15555550199');
    expect(JSON.stringify(result)).not.toContain(upstreamBody);
  });

  test('preserves only allowlisted retry and correlation headers', async () => {
    nextResponse = { status: 429 };
    const before = requests.length;
    const result = await callTool({ name: 'list_calls', arguments: {} });

    expect(requests).toHaveLength(before + 1);
    expect(result.structuredContent).toEqual({
      error: expect.objectContaining({
        status: 429,
        retryAfterMs: 7000,
        requestId: 'req-synthetic-123',
      }),
    });
  });

  test.each<[string, NonNullable<typeof nextResponse>]>([
    ['HTTP 503', { status: 503 }],
    ['HTTP 429', { status: 429 }],
    ['a transport failure', { dropConnection: true }],
    ['a timeout', { timeout: true }],
  ])('marks create_call outcome uncertain after %s', async (_label, behavior) => {
    nextResponse = behavior;
    const before = requests.length;
    const result = await callTool({
      name: 'create_call',
      arguments: { customer: { number: '+15555550100' } },
    });

    expect(requests).toHaveLength(before + 1);
    expect(requests[before]?.method).toBe('POST');
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: expect.objectContaining({
        tool: 'create_call',
        outcome: 'uncertain',
        recovery: 'Call creation outcome is unknown after one request. Check Vapi call history before retrying.' +
          (behavior.status === 429 ? ' Observe the indicated retry delay.' : ''),
      }),
    });
    if (behavior.timeout) {
      expect(result.structuredContent).toEqual({
        error: expect.objectContaining({ code: 'UPSTREAM_TIMEOUT', source: 'transport' }),
      });
    }
    expect(JSON.stringify(result)).not.toContain('customer-secret-123');
  });

  test.each<[number, string | string[], string[]]>([
    [400, 'Phone number with ID 9fd4c19 not found', ['The phone number was not found. Check the phoneNumberId and connected account.']],
    [422, ['assistant.voice.voiceId must be one of: opaque-credential', 'Missing credential: provider-key-123', 'Unrecognized private detail'], [
      'Check the voiceId supported by the selected voice provider.',
      'Check that the required provider credential is configured in Vapi.',
    ]],
  ])('returns safe diagnostics for an HTTP %i rejection', async (status, message, details) => {
    nextResponse = { status, body: JSON.stringify({ message }) };
    const result = await callTool({ name: 'create_call', arguments: { customer: { number: '+15555550100' } } });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: expect.objectContaining({ status, outcome: 'failed', details }),
    });
    expect(parseToolResponse(result)).toEqual({ error: expect.stringContaining(details.join(' ')) });
    for (const privateValue of ['9fd4c19', 'opaque-credential', 'provider-key-123', 'Unrecognized private detail']) {
      expect(JSON.stringify(result)).not.toContain(privateValue);
    }
  });

  test.each([
    ['update_assistant', 'assistantId', '/assistant'],
    ['update_tool', 'toolId', '/tool'],
  ])('reports a failed prerequisite read for %s without an uncertain write', async (name, idField, route) => {
    const id = 'a01f7e8a-9511-435a-b7f6-684068039bed';
    nextResponse = { status: 503 };
    const before = requests.length;
    const result = await callTool({ name, arguments: { [idField]: id } });

    expect(requests.slice(before)).toEqual([{ method: 'GET', path: route + '/' + id }]);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: expect.objectContaining({ tool: name, outcome: 'failed', recovery: 'Retry the read later.' }),
    });
  });

  test('sanitizes schema fetch failures through a real MCP client and SDK', async () => {
    nextResponse = { dropConnection: true };
    const before = requests.length;
    const result = await callTool({ name: 'get_api_schema', arguments: { search: 'call' } });
    expect(requests).toHaveLength(before + 1);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: expect.objectContaining({ tool: 'get_api_schema', outcome: 'failed' }) });
    expect(JSON.stringify(result)).not.toContain('SEEDED_SECRET');
  });

  test('keeps ordinary successful MCP results successful', async () => {
    nextResponse = { status: 200 };
    const before = requests.length;
    const result = await callTool({ name: 'list_calls', arguments: {} });

    expect(requests).toHaveLength(before + 1);
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text' })])
    );
  });

  test('preserves SDK content variants, metadata and request context through the wrapper', async () => {
    const result = await callTool({ name: 'result_passthrough', arguments: {} });
    expect(result.content).toEqual([{ type: 'image', data: 'AA==', mimeType: 'image/png' }]);
    expect(result.structuredContent).toEqual({ contextReceived: true });
    expect(result._meta).toEqual({ fixture: true });
  });

  test('sanitizes synchronous failures at the shared boundary', async () => {
    const result = await callTool({ name: 'synchronous_failure', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: expect.objectContaining({ tool: 'synchronous_failure' }) });
    expect(JSON.stringify(result)).not.toContain('SEEDED_SECRET');
  });
});
