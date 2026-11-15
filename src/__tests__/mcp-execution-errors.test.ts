import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { registerCallTools } from '../tools/call.js';

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
    | { status?: number; dropConnection?: boolean }
    | undefined;

  beforeAll(async () => {
    requests = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = new URL(String(input));
      requests.push({ method: init?.method, path: `${requestUrl.pathname}${requestUrl.search}` });
      const behavior = nextResponse;
      nextResponse = undefined;
      if (behavior?.dropConnection) {
        throw new TypeError('fetch failed');
      }
      const body = behavior?.status !== undefined && behavior.status >= 400
        ? upstreamBody
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
      timeoutInSeconds: 1,
    });
    mcpServer = new McpServer({ name: 'error-test-server', version: 'test' });
    registerCallTools(mcpServer, vapi);
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
    const result = await callTool({ name: 'list_calls', arguments: {} });

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
    ['a transport failure', { dropConnection: true }],
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
        recovery: behavior.dropConnection
          ? 'Check whether the operation completed before retrying.'
          : 'Retry reads later; verify resource state before retrying a write.',
      }),
    });
    expect(JSON.stringify(result)).not.toContain('customer-secret-123');
  });

  test('keeps ordinary successful MCP results successful', async () => {
    nextResponse = { status: 200 };
    const result = await callTool({ name: 'list_calls', arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text' })])
    );
  });
});
