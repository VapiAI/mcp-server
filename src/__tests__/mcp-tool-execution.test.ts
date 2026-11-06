import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';
import { parseToolResponse } from '../utils/response.js';

const timestamp = '2026-01-01T00:00:00.000Z';

const assistant = {
  id: 'assistant-1',
  createdAt: timestamp,
  updatedAt: timestamp,
  name: 'Compatibility Assistant',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    toolIds: ['tool-1'],
  },
  voice: {
    provider: '11labs',
    voiceId: 'sarah',
    model: 'eleven_turbo_v2_5',
  },
  transcriber: {
    provider: 'deepgram',
    model: 'nova-3',
  },
};

const call = {
  id: 'call-1',
  createdAt: timestamp,
  updatedAt: timestamp,
  status: 'ended',
  endedReason: 'customer-ended-call',
  assistantId: assistant.id,
  phoneNumberId: 'phone-number-1',
  customer: { number: '+15555550100' },
};

const phoneNumber = {
  id: 'phone-number-1',
  createdAt: timestamp,
  updatedAt: timestamp,
  name: 'Compatibility Number',
  number: '+15555550101',
  status: 'active',
};

const tool = {
  id: 'tool-1',
  createdAt: timestamp,
  updatedAt: timestamp,
  type: 'function',
  function: {
    name: 'compatibility_tool',
    description: 'Compatibility tool',
    parameters: { type: 'object', properties: {} },
  },
  server: {
    url: 'https://example.test/tools',
    headers: {},
  },
};

const apiSpec = {
  paths: {},
  components: {
    schemas: {
      CreateTransferCallToolDTO: { type: 'object' },
      TransferPlan: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          fallbackPlan: { $ref: '#/components/schemas/TransferFallbackPlan' },
        },
      },
      TransferFallbackPlan: { type: 'object' },
    },
  },
};

const vapiOperations = {
  fetch: jest.fn(async () => new Response(JSON.stringify(apiSpec))),
  assistants: {
    list: jest.fn(async () => [assistant]),
    get: jest.fn(async () => assistant),
    create: jest.fn(async () => assistant),
    update: jest.fn(async () => assistant),
  },
  calls: {
    list: jest.fn(async () => [call]),
    get: jest.fn(async () => call),
    create: jest.fn(async () => call),
  },
  phoneNumbers: {
    list: jest.fn(async () => [phoneNumber]),
    get: jest.fn(async () => phoneNumber),
  },
  tools: {
    list: jest.fn(async () => [tool]),
    get: jest.fn(async () => tool),
    create: jest.fn(async () => tool),
    update: jest.fn(async () => tool),
  },
};

describe('MCP tool execution compatibility', () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    server = new McpServer({
      name: 'tool-execution-test-server',
      version: '0.0.0',
    });
    registerAllTools(server, vapiOperations as unknown as VapiClient);

    client = new Client({
      name: 'tool-execution-test-client',
      version: '0.0.0',
    });
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

  test.each([
    [
      'list_assistants',
      vapiOperations.assistants.list,
      expect.objectContaining({
        id: assistant.id,
        name: assistant.name,
        llm: { provider: 'openai', model: 'gpt-4o' },
        toolIds: ['tool-1'],
      }),
    ],
    [
      'list_calls',
      vapiOperations.calls.list,
      expect.objectContaining({
        id: call.id,
        status: 'ended',
        assistantId: assistant.id,
        customer: { number: '+15555550100' },
      }),
    ],
    [
      'list_phone_numbers',
      vapiOperations.phoneNumbers.list,
      expect.objectContaining({
        id: phoneNumber.id,
        name: phoneNumber.name,
        phoneNumber: '+15555550101',
        status: 'active',
      }),
    ],
    [
      'list_tools',
      vapiOperations.tools.list,
      expect.objectContaining({
        id: tool.id,
        type: 'function',
        name: 'compatibility_tool',
        description: 'Compatibility tool',
      }),
    ],
  ])('%s forwards the list limit and returns transformed results', async (
    name,
    listOperation,
    expectedResult
  ) => {
    const result = await invoke(name, {});

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expectedResult);
    expect(listOperation).toHaveBeenLastCalledWith({ limit: 10 });
  });

  test.each([
    [
      'get_assistant',
      { assistantId: assistant.id },
      vapiOperations.assistants.get,
      assistant.id,
    ],
    ['get_call', { callId: call.id }, vapiOperations.calls.get, call.id],
    [
      'get_phone_number',
      { phoneNumberId: phoneNumber.id },
      vapiOperations.phoneNumbers.get,
      phoneNumber.id,
    ],
    ['get_tool', { toolId: tool.id }, vapiOperations.tools.get, tool.id],
  ])('%s forwards its identifier and returns a transformed result', async (
    name,
    args,
    getOperation,
    expectedId
  ) => {
    const result = await invoke(name, args);
    expect(result.id).toBe(expectedId);
    expect(getOperation).toHaveBeenLastCalledWith({ id: expectedId });
  });

  test('create_assistant preserves schema defaults and calls Vapi', async () => {
    const result = await invoke('create_assistant', {
      name: 'Compatibility Assistant',
    });

    expect(result.id).toBe(assistant.id);
    expect(vapiOperations.assistants.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'Compatibility Assistant',
        model: expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o',
        }),
        voice: expect.objectContaining({
          provider: '11labs',
          voiceId: 'sarah',
        }),
        transcriber: expect.objectContaining({
          provider: 'deepgram',
          model: 'nova-3',
        }),
      })
    );
  });

  test('update_assistant preserves the identifier and update payload', async () => {
    const result = await invoke('update_assistant', {
      assistantId: assistant.id,
      name: 'Updated Assistant',
    });

    expect(result.id).toBe(assistant.id);
    expect(vapiOperations.assistants.update).toHaveBeenLastCalledWith({
      id: assistant.id,
      name: 'Updated Assistant',
    });
  });

  test('create_call preserves the outbound-call payload passed to Vapi', async () => {
    const result = await invoke('create_call', {
      assistantId: assistant.id,
      phoneNumberId: phoneNumber.id,
      customer: { number: '+15555550100' },
    });

    expect(result.id).toBe(call.id);
    expect(vapiOperations.calls.create).toHaveBeenLastCalledWith({
      assistantId: assistant.id,
      phoneNumberId: phoneNumber.id,
      customer: { number: '+15555550100' },
    });
  });

  test('create_tool preserves an API request tool payload', async () => {
    const result = await invoke('create_tool', {
      type: 'apiRequest',
      name: 'compatibility_tool',
      description: 'Compatibility tool',
      apiRequest: {
        url: 'https://example.test/tools',
        method: 'GET',
      },
    });

    expect(result.id).toBe(tool.id);
    expect(vapiOperations.tools.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'apiRequest',
        url: 'https://example.test/tools',
        method: 'GET',
      })
    );
  });

  test('update_tool preserves the identifier and update payload', async () => {
    const result = await invoke('update_tool', {
      toolId: tool.id,
      name: 'updated_compatibility_tool',
    });

    expect(result.id).toBe(tool.id);
    expect(vapiOperations.tools.update).toHaveBeenLastCalledWith({
      id: tool.id,
      body: { function: { name: 'updated_compatibility_tool' } },
    });
  });

  test('rejects invalid tool input before calling Vapi', async () => {
    const callsBefore = vapiOperations.assistants.create.mock.calls.length;

    const response = await client.callTool({
      name: 'create_assistant',
      arguments: {},
    });

    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Input validation error'),
      }),
    ]);
    expect(vapiOperations.assistants.create).toHaveBeenCalledTimes(callsBefore);
  });

  test('returns a visible error response when Vapi rejects an operation', async () => {
    vapiOperations.calls.list.mockRejectedValueOnce(
      new Error('simulated Vapi failure') as never
    );

    const response = await client.callTool({
      name: 'list_calls',
      arguments: {},
    });

    expect(parseToolResponse(response)).toEqual({
      error: 'Error: simulated Vapi failure',
    });
  });

  test('get_api_schema searches names and returns one schema with its references', async () => {
    const found = await invoke('get_api_schema', { search: 'transfer' });
    expect(found).toEqual({
      matches: [
        'CreateTransferCallToolDTO',
        'TransferFallbackPlan',
        'TransferPlan',
      ],
      total: 3,
    });

    const result = await invoke('get_api_schema', { name: 'TransferPlan' });
    expect(result).toEqual({
      name: 'TransferPlan',
      schema: apiSpec.components.schemas.TransferPlan,
      referencedSchemas: ['TransferFallbackPlan'],
    });

    expect(vapiOperations.fetch).toHaveBeenCalledTimes(1);
    expect(vapiOperations.fetch).toHaveBeenCalledWith(
      'https://api.vapi.ai/api-json'
    );
  });

  test('get_api_schema suggests similar names for an unknown schema', async () => {
    const response = await client.callTool({
      name: 'get_api_schema',
      arguments: { name: 'Fallback' },
    });

    expect(parseToolResponse(response)).toEqual({
      error:
        'Error: No schema named Fallback. Similar names: TransferFallbackPlan',
    });
  });

  test('create_tool sends destination and additional fields it does not model', async () => {
    await invoke('create_tool', {
      type: 'transferCall',
      name: 'transfer_to_sales',
      transferCall: {
        destinations: [
          {
            type: 'number',
            number: '+15555550102',
            transferPlan: { mode: 'warm-transfer-say-summary' },
          },
        ],
      },
      additionalFields: {
        messages: [{ type: 'request-start', content: 'Transferring you now' }],
      },
    });

    expect(vapiOperations.tools.create).toHaveBeenLastCalledWith({
      type: 'transferCall',
      function: { name: 'transfer_to_sales' },
      destinations: [
        {
          type: 'number',
          number: '+15555550102',
          transferPlan: { mode: 'warm-transfer-say-summary' },
        },
      ],
      messages: [{ type: 'request-start', content: 'Transferring you now' }],
    });
  });

  test('update_tool sends additional fields as given', async () => {
    await invoke('update_tool', {
      toolId: tool.id,
      additionalFields: { rejectionPlan: { conditions: [] } },
    });

    expect(vapiOperations.tools.update).toHaveBeenLastCalledWith({
      id: tool.id,
      body: { rejectionPlan: { conditions: [] } },
    });
  });

});
