import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { registerCallTools } from '../tools/call.js';

const input = {
  assistantId: 'assistant-1',
  phoneNumberId: 'phone-1',
  customer: { number: '+15555550100' },
};

function createHarness(fetch: typeof globalThis.fetch) {
  const server = new McpServer({ name: 'call-retry-test', version: '1.0.0' });
  const api = new VapiClient({ token: 'test-token', fetch, timeoutInSeconds: 1 });
  registerCallTools(server, api);
  const client = new Client({ name: 'call-retry-test-client', version: '1.0.0' });
  return { server, client };
}

async function connect(harness: ReturnType<typeof createHarness>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await harness.server.connect(serverTransport);
  await harness.client.connect(clientTransport);
}

describe('create_call SDK retry policy', () => {
  let harness: ReturnType<typeof createHarness>;

  afterEach(async () => {
    await harness?.client.close();
    await harness?.server.close();
  });

  test('does not retry a retryable HTTP failure', async () => {
    const fetch = jest.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ message: 'temporary API failure' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    );
    harness = createHarness(fetch);
    await connect(harness);

    const result = await harness.client.callTool({ name: 'create_call', arguments: input });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.content).toContainEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('Check Vapi call history before retrying.'),
    }));
  });

  test('surfaces accepted-then-lost responses as uncertain without a second POST', async () => {
    let acceptedCalls = 0;
    const fetch = jest.fn<typeof globalThis.fetch>(async () => {
      acceptedCalls += 1;
      throw new TypeError('socket closed after request was accepted');
    });
    harness = createHarness(fetch);
    await connect(harness);

    const result = await harness.client.callTool({ name: 'create_call', arguments: input });

    expect(acceptedCalls).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.content).toContainEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('Call creation outcome is unknown after one request'),
    }));
  });

  test('allows distinct concurrent invocations and an explicit later repeat', async () => {
    let callNumber = 0;
    const fetch = jest.fn<typeof globalThis.fetch>(async () => {
      callNumber += 1;
      return new Response(JSON.stringify({
        id: `call-${callNumber}`,
        createdAt: '2026-11-15T00:00:00.000Z',
        updatedAt: '2026-11-15T00:00:00.000Z',
        status: 'queued',
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    harness = createHarness(fetch);
    await connect(harness);

    const concurrent = await Promise.all([
      harness.client.callTool({ name: 'create_call', arguments: input }),
      harness.client.callTool({ name: 'create_call', arguments: input }),
    ]);
    const later = await harness.client.callTool({ name: 'create_call', arguments: input });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(concurrent.every(result => !result.isError)).toBe(true);
    expect(later.isError).not.toBe(true);
  });
});
