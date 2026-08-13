import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
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

      expect(normalizedCatalog).toHaveLength(13);
      expect(normalizedCatalog).toEqual(expectedCatalog);

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
