import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';
import { parseToolResponse } from '../utils/response.js';

const squad = {
  id: 'squad-1',
  name: 'Front desk',
  members: [
    {
      assistantId: 'asst-1',
      assistantDestinations: [
        {
          type: 'assistant',
          assistantName: 'Billing',
          description: 'Billing questions',
          transferMode: 'swap-system-message-in-history',
        },
      ],
    },
    { assistantId: 'asst-2' },
  ],
  membersOverrides: { firstMessageMode: 'assistant-waits-for-user' },
};

const vapiOperations = {
  squads: {
    list: jest.fn(async () => [squad]),
    get: jest.fn(async () => squad),
    create: jest.fn(async () => squad),
    update: jest.fn(async () => squad),
  },
};

describe('squad tools', () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    server = new McpServer({ name: 'squad-test-server', version: '0.0.0' });
    registerAllTools(server, vapiOperations as unknown as VapiClient);
    client = new Client({ name: 'squad-test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  async function invoke(name: string, args: Record<string, unknown>) {
    const response = await client.callTool({ name, arguments: args });
    const parsed = parseToolResponse(response);
    expect(parsed?.error).toBeUndefined();
    return parsed;
  }

  test('list_squads and get_squad return the API objects', async () => {
    expect(await invoke('list_squads', {})).toEqual([squad]);
    expect(vapiOperations.squads.list).toHaveBeenLastCalledWith({ limit: 50 });

    expect(await invoke('get_squad', { squadId: 'squad-1' })).toEqual(squad);
    expect(vapiOperations.squads.get).toHaveBeenLastCalledWith({
      id: 'squad-1',
    });
  });

  test('create_squad sends members, including fields it does not list', async () => {
    await invoke('create_squad', {
      name: squad.name,
      members: squad.members,
      membersOverrides: squad.membersOverrides,
    });

    expect(vapiOperations.squads.create).toHaveBeenLastCalledWith({
      name: squad.name,
      members: squad.members,
      membersOverrides: squad.membersOverrides,
    });
  });

  test('create_squad requires at least one member', async () => {
    const response = await client.callTool({
      name: 'create_squad',
      arguments: { name: 'Empty', members: [] },
    });

    expect(response.isError).toBe(true);
    expect(vapiOperations.squads.create).toHaveBeenCalledTimes(1);
  });

  test('update_squad with only a name keeps the current members', async () => {
    await invoke('update_squad', { squadId: 'squad-1', name: 'Reception' });

    expect(vapiOperations.squads.update).toHaveBeenLastCalledWith({
      id: 'squad-1',
      name: 'Reception',
      members: squad.members,
    });
  });

  test('update_squad replaces members when given', async () => {
    await invoke('update_squad', {
      squadId: 'squad-1',
      members: [{ assistantId: 'asst-3' }],
    });

    expect(vapiOperations.squads.update).toHaveBeenLastCalledWith({
      id: 'squad-1',
      members: [{ assistantId: 'asst-3' }],
    });
  });
});
