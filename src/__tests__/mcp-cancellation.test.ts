import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';

const callId = '00000000-0000-4000-8000-000000000002';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!check() && Date.now() < deadline) await delay(1);
  expect(check()).toBe(true);
}

describe('MCP cancellation reaches the Vapi SDK request', () => {
  let server: McpServer | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    client = undefined;
    server = undefined;
  });

  async function connect(api: VapiClient) {
    server = new McpServer({ name: 'cancellation-test-server', version: '0.0.0' });
    registerAllTools(server, api);
    client = new Client({ name: 'cancellation-test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  test('caller cancellation aborts an in-flight SDK HTTP read', async () => {
    let observedSignal: AbortSignal | undefined;
    const api = new VapiClient({
      token: 'synthetic-test-token',
      baseUrl: 'https://vapi.test',
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        observedSignal = init?.signal ?? undefined;
        observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
      }),
    });
    const mcp = await connect(api);
    const caller = new AbortController();
    const request = mcp.callTool(
      { name: 'get_call', arguments: { callId } },
      undefined, { signal: caller.signal },
    );

    await waitFor(() => observedSignal !== undefined);
    caller.abort(new DOMException('Caller cancelled', 'AbortError'));

    await expect(request).rejects.toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
  });

  test('cancellation during SDK retry backoff prevents a second upstream HTTP request', async () => {
    let fetchInvocations = 0;
    let upstreamAttempts = 0;
    const api = new VapiClient({
      token: 'synthetic-test-token',
      baseUrl: 'https://vapi.test',
      maxRetries: 2,
      fetch: async (_input, init) => {
        fetchInvocations += 1;
        // Match fetch behavior: a request with an already-aborted signal is
        // rejected before it can reach the upstream service.
        if (init?.signal?.aborted) throw init.signal.reason;
        upstreamAttempts += 1;
        return new Response(JSON.stringify({ message: 'synthetic upstream failure' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const mcp = await connect(api);
    const caller = new AbortController();
    const request = mcp.callTool(
      { name: 'get_call', arguments: { callId } },
      undefined, { signal: caller.signal },
    );

    await waitFor(() => upstreamAttempts === 1);
    await delay(20);
    caller.abort(new DOMException('Caller cancelled during retry wait', 'AbortError'));
    await expect(request).rejects.toBeDefined();
    await delay(1_300);

    expect(upstreamAttempts).toBe(1);
    expect(fetchInvocations).toBe(1);
  });

  test('the total deadline stops a retry wait', async () => {
    let attempts = 0;
    const api = new VapiClient({
      token: 'synthetic-test-token', baseUrl: 'https://vapi.test',
      fetch: async () => {
        attempts++;
        return new Response('{}', { status: 503, headers: { 'Retry-After': '60', 'content-type': 'application/json' } });
      },
    });
    const mcp = await connect(api);
    jest.useFakeTimers();
    try {
      const request = mcp.callTool({ name: 'get_call', arguments: { callId } }, undefined, { timeout: 60_000 });
      await jest.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      await jest.advanceTimersByTimeAsync(30_001);
      const response = await request;
      expect(response.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('deadline') })]));
      expect(attempts).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a cancelled accepted write remains an upstream effect', async () => {
    let accepted = 0;
    const api = new VapiClient({
      token: 'synthetic-test-token', baseUrl: 'https://vapi.test',
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        accepted++;
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    });
    const mcp = await connect(api);
    const caller = new AbortController();
    const request = mcp.callTool({ name: 'create_assistant', arguments: { name: 'Synthetic assistant' } }, undefined, { signal: caller.signal });
    await waitFor(() => accepted === 1);
    caller.abort();
    await expect(request).rejects.toBeDefined();
    expect(accepted).toBe(1);
  });

  test('a retryable response still retries and returns the upstream result', async () => {
    let attempts = 0;
    const api = new VapiClient({
      token: 'synthetic-test-token', baseUrl: 'https://vapi.test',
      fetch: async () => {
        attempts++;
        return attempts === 1
          ? new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ id: callId, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', status: 'ended' }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const mcp = await connect(api);
    const result = await mcp.callTool({ name: 'get_call', arguments: { callId } });
    expect(attempts).toBe(2);
    expect(JSON.stringify(result)).toContain(callId);
  });
});
