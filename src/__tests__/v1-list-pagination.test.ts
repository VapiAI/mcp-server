import { describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';
import { v1ListPage } from '../tools/list.js';
import { parseToolResponse } from '../utils/response.js';

const timestamp = (index: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 60 - index)).toISOString();
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  createdAt: timestamp(index),
  updatedAt: timestamp(index),
  name: `Entry ${index + 1}`,
  number: '+15555550100',
  status: 'ended',
  type: 'function',
  model: { provider: 'openai', model: 'gpt-4o' },
  voice: { provider: '11labs', voiceId: 'sarah' },
  transcriber: { provider: 'deepgram', model: 'nova-3' },
  function: { name: 'example', parameters: {} },
}));

describe('bounded v1 pagination', () => {
  test('defers a timestamp group crossing the page boundary', () => {
    const items = rows(11);
    items[10].createdAt = items[9].createdAt;
    const page = v1ListPage(items);
    expect(page.results).toEqual(items.slice(0, 9));
    expect(page.pagination).toEqual({ pageSize: 10, hasMore: true, nextBefore: items[8].createdAt });
  });

  test('reports an oversized timestamp group without a cursor that would skip it', () => {
    const items = rows(11).map(item => ({ ...item, createdAt: timestamp(0) }));
    const page = v1ListPage(items);
    expect(page.results).toHaveLength(10);
    expect(page.pagination).toEqual({
      pageSize: 10, hasMore: true, nextBefore: null,
      warning: expect.stringContaining('more than 10 items share'),
    });
  });

  test('marks an exactly full final page as complete', () => {
    expect(v1ListPage(rows(10)).pagination).toEqual({ pageSize: 10, hasMore: false, nextBefore: null });
  });

  test('marks an empty page as complete', () => {
    expect(v1ListPage([])).toEqual({ results: [], pagination: { pageSize: 10, hasMore: false, nextBefore: null } });
  });

  test.each([
    ['list_assistants', 'assistants'],
    ['list_calls', 'calls'],
    ['list_tools', 'tools'],
    ['list_phone_numbers', 'phoneNumbers'],
  ])('%s traverses bounded pages and rejects unsupported input before calling Vapi', async (name, resource) => {
    const items = rows(26);
    // This tie crosses the first page boundary and must not lose either row.
    items[10].createdAt = items[9].createdAt;
    const list = jest.fn(async (request: { limit: number; createdAtLt?: string }) => items
      .filter(item => !request.createdAtLt || item.createdAt < request.createdAtLt)
      .slice(0, request.limit));
    const server = new McpServer({ name: 'v1-pagination', version: '0.0.0' });
    registerAllTools(server, { [resource]: { list } } as unknown as VapiClient);
    const client = new Client({ name: 'v1-pagination-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const ids: string[] = [];
      let before: string | undefined;
      for (let page = 0; page < 4; page++) {
        const response = await client.callTool({ name, arguments: before ? { before } : {} });
        const textResults = parseToolResponse(response);
        const content = response.structuredContent as {
          results: { id: string }[];
          pagination: { pageSize: number; hasMore: boolean; nextBefore: string | null };
        };
        expect(textResults).toEqual(content.results);
        expect(content.results.length).toBeLessThanOrEqual(10);
        ids.push(...content.results.map(item => item.id));
        if (!content.pagination.hasMore) break;
        expect(content.pagination.nextBefore).toEqual(items[ids.length - 1].createdAt);
        before = content.pagination.nextBefore!;
      }
      expect(ids).toEqual(items.map(item => item.id));
      expect(new Set(ids).size).toBe(26);
      expect(list.mock.calls.every(([request]) => request.limit === 11)).toBe(true);
      expect(list.mock.calls[1][0]).toEqual({ limit: 11, createdAtLt: items[8].createdAt });

      const callsBeforeInvalidInput = list.mock.calls.length;
      for (const args of [{ limit: 1000 }, { before: 'not-a-date' }, { cursor: 'unsupported' }]) {
        const invalid = await client.callTool({ name, arguments: args });
        expect(invalid.isError).toBe(true);
      }
      expect(list).toHaveBeenCalledTimes(callsBeforeInvalidInput);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
