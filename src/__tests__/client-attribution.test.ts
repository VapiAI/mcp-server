import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import { createVapiClient } from '../client.js';
import { registerAllTools } from '../tools/index.js';

const packageMetadata = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };

describe('local MCP client attribution', () => {
  let server: McpServer;
  let client: Client;
  let requests: Request[];
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeAll(async () => {
    requests = [];
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push(new Request(input, init));
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    server = new McpServer({ name: 'attribution-test-server', version: '0.0.0' });
    registerAllTools(server, createVapiClient('test-token'));

    client = new Client({ name: 'attribution-test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    fetchMock.mockRestore();
  });

  test('labels the real SDK request with package version, tool, and process session', async () => {
    const response = await client.callTool({ name: 'list_assistants', arguments: {} });

    expect(response.isError).not.toBe(true);
    expect(requests).toHaveLength(1);
    const attribution = requests[0].headers.get('x-vapi-client');
    expect(attribution).toMatch(
      new RegExp(`^mcp/${packageMetadata.version}; command=list_assistants; run=local-[A-Za-z0-9-]{8,64}$`)
    );
  });
});
