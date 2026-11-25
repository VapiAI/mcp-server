import { afterEach, describe, expect, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';
import { createFixtureFetch } from './fixture-api.js';

describe('MCPJam fixture vertical slice', () => {
  let fixture: ReturnType<typeof createFixtureFetch> | undefined;
  let client: Client | undefined;
  let server: McpServer | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    client = undefined;
    server = undefined;
    fixture = undefined;
  });

  test('lists the complete production registration and creates through the real Vapi SDK transformer against loopback', async () => {
    fixture = createFixtureFetch();
    server = new McpServer({ name: 'fixture-test', version: '1' });
    registerAllTools(server, new VapiClient({ token: 'fixture-only', baseUrl: fixture.url, fetch: fixture.fetch, maxRetries: 0 }));
    client = new Client({ name: 'fixture-client', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const catalog = await client.listTools();
    expect(catalog.tools).toHaveLength(29);
    expect(catalog.tools.map(tool => tool.name)).toContain('create_assistant');

    const response = await client.callTool({
      name: 'create_assistant',
      arguments: {
        name: 'Harbor Intake',
        llm: { provider: 'openai', model: 'gpt-4o-mini' },
        instructions: 'Help callers book an appointment.',
        voice: { provider: '11labs', voiceId: 'sarah' },
        transcriber: { provider: 'deepgram', model: 'nova-3' },
        firstMessage: 'Thanks for calling Harbor Dental. How can I help?',
      },
    });
    expect(response.isError).not.toBe(true);
    const created = fixture.snapshot().assistants[0] as Record<string, any>;
    expect(created.model.messages[0].content).toBe('Help callers book an appointment.');
    expect(created.firstMessage).toBe('Thanks for calling Harbor Dental. How can I help?');
    expect(fixture.snapshot().actions).toContainEqual(expect.objectContaining({ method: 'POST', path: '/assistant' }));
  });

  test('validation failures stay in the registration path and never reach the Vapi fixture', async () => {
    fixture = createFixtureFetch('existing-assistant');
    server = new McpServer({ name: 'fixture-test', version: '1' });
    registerAllTools(server, new VapiClient({ token: 'fixture-only', baseUrl: fixture.url, fetch: fixture.fetch, maxRetries: 0 }));
    client = new Client({ name: 'fixture-client', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const response = await client.callTool({ name: 'update_assistant', arguments: { assistantId: 'not-an-id', firstMessage: 'Hello' } });
    expect(response.isError).toBe(true);
    expect(fixture.snapshot().actions).toHaveLength(0);
    expect(fixture.snapshot().assistants[0]?.id).toBe('00000000-0000-4000-8000-000000000001');
  });

  test('runs and inspects the prepared simulation through the SDK routes', async () => {
    fixture = createFixtureFetch('simulation-ready');
    server = new McpServer({ name: 'fixture-test', version: '1' });
    registerAllTools(server, new VapiClient({ token: 'fixture-only', baseUrl: fixture.url, fetch: fixture.fetch, maxRetries: 0 }));
    client = new Client({ name: 'fixture-client', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const run = await client.callTool({ name: 'run_simulations', arguments: { assistantId: '00000000-0000-4000-8000-000000000001', simulationIds: ['00000000-0000-4000-8000-000000000009'] } });
    expect(run.isError).not.toBe(true);
    const state = fixture.snapshot();
    const runId = state.simulationRuns[0]?.id as string;
    const result = await client.callTool({ name: 'get_simulation_run', arguments: { runId } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('failed');
    expect(fixture.snapshot().actions).toContainEqual(expect.objectContaining({ method: 'GET', path: `/eval/simulation/run/${runId}/item` }));
  });

  test('get_call reports the current transcript and recording limitation through the production transformer', async () => {
    fixture = createFixtureFetch('call-history');
    server = new McpServer({ name: 'fixture-test', version: '1' });
    registerAllTools(server, new VapiClient({ token: 'fixture-only', baseUrl: fixture.url, fetch: fixture.fetch, maxRetries: 0 }));
    client = new Client({ name: 'fixture-client', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const response = await client.callTool({ name: 'get_call', arguments: { callId: '00000000-0000-4000-8000-000000000002' } });
    const content = response.content as Array<{ type: string; text?: string }>;
    const text = content.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n');
    expect(text).toContain('"status":"ended"');
    expect(text).not.toContain('transcript');
    expect(text).not.toContain('recordingUrl');
  });
});
