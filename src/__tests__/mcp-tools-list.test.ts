import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';

const expectedCatalog = JSON.parse(
  readFileSync(new URL('./fixtures/tools-list.json', import.meta.url), 'utf8')
);

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, nestedValue]) => [key, sortObjectKeys(nestedValue)])
    );
  }

  return value;
}

describe('MCP tools/list compatibility baseline', () => {
  test('returns the complete normalized public tool catalog without calling Vapi', async () => {
    const vapiOperations = {
      assistants: {
        list: jest.fn(() => {
          throw new Error('Unexpected assistants.list call');
        }),
        get: jest.fn(() => {
          throw new Error('Unexpected assistants.get call');
        }),
        create: jest.fn(() => {
          throw new Error('Unexpected assistants.create call');
        }),
        update: jest.fn(() => {
          throw new Error('Unexpected assistants.update call');
        }),
      },
      calls: {
        list: jest.fn(() => {
          throw new Error('Unexpected calls.list call');
        }),
        get: jest.fn(() => {
          throw new Error('Unexpected calls.get call');
        }),
        create: jest.fn(() => {
          throw new Error('Unexpected calls.create call');
        }),
      },
      phoneNumbers: {
        list: jest.fn(() => {
          throw new Error('Unexpected phoneNumbers.list call');
        }),
        get: jest.fn(() => {
          throw new Error('Unexpected phoneNumbers.get call');
        }),
      },
      tools: {
        list: jest.fn(() => {
          throw new Error('Unexpected tools.list call');
        }),
        get: jest.fn(() => {
          throw new Error('Unexpected tools.get call');
        }),
        create: jest.fn(() => {
          throw new Error('Unexpected tools.create call');
        }),
        update: jest.fn(() => {
          throw new Error('Unexpected tools.update call');
        }),
      },
    };
    const server = new McpServer({
      name: 'catalog-test-server',
      version: '0.0.0',
    });
    registerAllTools(server, vapiOperations as unknown as VapiClient);

    const client = new Client({
      name: 'catalog-test-client',
      version: '0.0.0',
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const response = await client.listTools();
      const normalizedCatalog = response.tools
        .map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema: sortObjectKeys(inputSchema),
        }))
        .sort(({ name: left }, { name: right }) =>
          compareStrings(left, right)
        );

      expect(normalizedCatalog).toHaveLength(25);
      expect(normalizedCatalog).toEqual(expectedCatalog);

      // This is the agent-visible payload, not just the pretty-printed fixture.
      expect(Buffer.byteLength(JSON.stringify(normalizedCatalog))).toBeLessThan(20_000);
      for (const name of ['create_assistant', 'update_assistant']) {
        const tool = response.tools.find(tool => tool.name === name)!;
        expect(Buffer.byteLength(JSON.stringify(tool))).toBeLessThan(4_000);
        expect(tool.inputSchema.properties?.voice).toEqual(expect.objectContaining({
          type: 'object', required: ['provider', 'voiceId'],
          properties: { provider: { type: 'string' }, voiceId: { type: 'string' }, model: { type: 'string' } },
        }));
      }
      expect(JSON.stringify(normalizedCatalog)).not.toMatch(/"(?:definitions|\$defs|\$ref)":/);

      // Compact discovery remains usable JSON Schema, but is intentionally
      // broader than the full validator used by the execution boundary.
      const ajv = new Ajv({ strict: false });
      addFormats.default(ajv);
      const id = '00000000-0000-4000-8000-000000000001';
      const validArguments: Record<string, object> = {
        create_assistant: { name: 'Catalog contract' }, update_assistant: { assistantId: id },
        get_assistant: { assistantId: id }, get_call: { callId: id },
        get_phone_number: { phoneNumberId: id }, get_tool: { toolId: id },
        create_call: {}, create_tool: { type: 'apiRequest', apiRequest: { url: 'https://example.test' } },
        update_tool: { toolId: id },
        create_simulation: { scenarioId: id, personalityId: id },
        create_simulation_personality: { name: 'Tester', assistant: {} },
        create_simulation_scenario: { name: 'Test', instructions: 'Ask for help', evaluations: [] },
        create_simulation_suite: { name: 'Suite', simulationIds: [id] },
        get_simulation_run: { runId: id }, get_simulation_run_item: { runId: id, itemId: id },
        run_simulations: { assistantId: id, simulationIds: [id] },
      };
      for (const tool of response.tools) {
        expect({ name: tool.name, valid: ajv.compile(tool.inputSchema)(validArguments[tool.name] ?? {}) }).toEqual({ name: tool.name, valid: true });
      }
      const createTool = ajv.compile(response.tools.find(tool => tool.name === 'create_tool')!.inputSchema);
      expect(createTool({ type: 'apiRequest' })).toBe(false);
      expect(createTool({ type: 'function', description: 'A definition without a name' })).toBe(false);
      expect(createTool({ type: 'function', description: '' })).toBe(true);

      const invocationCount = Object.values(vapiOperations).reduce(
        (total, operations) =>
          total +
          Object.values(operations).reduce(
            (groupTotal, operation) =>
              groupTotal + operation.mock.calls.length,
            0
          ),
        0
      );
      expect(invocationCount).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
