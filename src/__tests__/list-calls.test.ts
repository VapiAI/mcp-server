import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import type { Vapi } from '@vapi-ai/server-sdk';
import { registerCallTools } from '../tools/call.js';
import { parseToolResponse } from '../utils/response.js';

const id = '00000000-0000-4000-8000-000000000001';
const assistantId = '00000000-0000-4000-8000-000000000002';
const phoneNumberId = '00000000-0000-4000-8000-000000000003';
const timestamp = (index: number) => new Date(Date.UTC(2026, 0, 1, 0, 10, -index)).toISOString();
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  assistantId, phoneNumberId, status: 'ended',
  createdAt: timestamp(index), updatedAt: timestamp(index),
}));
type Page = {
  results: { id: string }[];
  pagination: { pageSize: number; hasMore: boolean; nextBefore: string | null; warning?: string };
};

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function connect(vapi: VapiClient) {
  const server = new McpServer({ name: 'call-filters', version: '0.0.0' });
  registerCallTools(server, vapi);
  const client = new Client({ name: 'call-filters-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return client;
}

describe('list_calls v1 filters', () => {
  test('advertises and sends every supported filter through the real SDK to GET /call', async () => {
    const fetch = jest.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('[]', {
      headers: { 'content-type': 'application/json' },
    }));
    const client = await connect(new VapiClient({ token: 'test-token', fetch }));
    const filters = {
      id, assistantId, phoneNumberId,
      createdAtGt: timestamp(100), createdAtLt: timestamp(0),
      createdAtGe: timestamp(100), createdAtLe: timestamp(0),
      updatedAtGt: timestamp(100), updatedAtLt: timestamp(0),
      updatedAtGe: timestamp(100), updatedAtLe: timestamp(0),
    };
    const tool = (await client.listTools()).tools.find(tool => tool.name === 'list_calls')!;
    expect(Object.keys(tool.inputSchema.properties!).sort()).toEqual([...Object.keys(filters), 'before', 'limit'].sort());
    const response = await client.callTool({ name: 'list_calls', arguments: { ...filters, limit: 100 } });
    expect(response.isError).not.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/call');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...filters, limit: '101' });
    expect((response.structuredContent as Page).pagination).toEqual({ pageSize: 100, hasMore: false, nextBefore: null });
  });

  test.each([1, 3, 25, 100])('paginates filtered results without losing boundary ties at limit %i', async limit => {
    const items = rows(limit * 2 + 3);
    // An interleaved call from another phone number must never enter a page.
    const unrelated = { ...items[0], id: 'other-call', phoneNumberId: assistantId };
    if (limit > 1) items[limit].createdAt = items[limit - 1].createdAt;
    const list = jest.fn(async (request: Vapi.ListCallsRequest) => [unrelated, ...items]
      .filter(item => item.phoneNumberId === request.phoneNumberId && item.assistantId === request.assistantId)
      .filter(item => !request.createdAtLt || Date.parse(item.createdAt) < Date.parse(request.createdAtLt))
      .slice(0, request.limit));
    const client = await connect({ calls: { list } } as unknown as VapiClient);
    const seen: string[] = [];
    let before: string | undefined;
    let complete = false;
    for (let i = 0; i < items.length + 1; i++) {
      const response = await client.callTool({ name: 'list_calls', arguments: {
        assistantId, phoneNumberId, limit, createdAtGe: timestamp(500), ...(before ? { before } : {}),
      } });
      expect(response.isError).not.toBe(true);
      const page = response.structuredContent as Page;
      expect(parseToolResponse(response)).toEqual(page.results);
      expect(page.pagination.pageSize).toBe(limit);
      expect(page.results.length).toBeLessThanOrEqual(limit);
      seen.push(...page.results.map(row => row.id));
      if (!page.pagination.hasMore) { complete = true; break; }
      expect(page.pagination.nextBefore).toBeTruthy();
      before = page.pagination.nextBefore!;
    }
    expect(complete).toBe(true);
    expect(seen).toEqual(items.map(item => item.id));
    for (const [request] of list.mock.calls) {
      expect(request).toEqual(expect.objectContaining({ assistantId, phoneNumberId, createdAtGe: timestamp(500), limit: limit + 1 }));
      expect(request).not.toHaveProperty('before');
    }
  });

  test.each([
    [timestamp(10), timestamp(20), timestamp(20)],
    [timestamp(20), timestamp(10), timestamp(20)],
    // Compare instants, not lexicographic order of timestamps with offsets.
    ['2026-01-01T10:00:00+10:00', '2026-01-01T01:00:00Z', '2026-01-01T10:00:00+10:00'],
  ])('intersects before %s with createdAtLt %s', async (before, createdAtLt, expected) => {
    const list = jest.fn(async (_request: Vapi.ListCallsRequest) => []);
    const client = await connect({ calls: { list } } as unknown as VapiClient);
    await client.callTool({ name: 'list_calls', arguments: { before, createdAtLt, phoneNumberId } });
    expect(list).toHaveBeenCalledWith({ createdAtLt: expected, phoneNumberId, limit: 11 });
  });

  test.each([1, 3, 100])('stops safely when a timestamp group exceeds limit %i', async limit => {
    const items = rows(limit + 1).map(row => ({ ...row, createdAt: timestamp(0) }));
    const list = jest.fn(async (_request: Vapi.ListCallsRequest) => items);
    const client = await connect({ calls: { list } } as unknown as VapiClient);
    const response = await client.callTool({ name: 'list_calls', arguments: { limit } });
    const page = response.structuredContent as Page;
    expect(page.results).toHaveLength(limit);
    expect(page.pagination).toEqual({
      pageSize: limit, hasMore: true, nextBefore: null,
      warning: expect.stringContaining(`more than ${limit} items share`),
    });
  });

  test('rejects invalid or unsupported input before the API is called', async () => {
    const list = jest.fn(async (_request: Vapi.ListCallsRequest) => []);
    const client = await connect({ calls: { list } } as unknown as VapiClient);
    const invalid = [
      ...[0, -1, 101, 1000, 1.5, '10', null].map(limit => ({ limit })),
      ...['id', 'assistantId', 'phoneNumberId'].map(key => ({ [key]: 'not-a-uuid' })),
      ...['before', 'createdAtGt', 'createdAtLt', 'createdAtGe', 'createdAtLe', 'updatedAtGt', 'updatedAtLt', 'updatedAtGe', 'updatedAtLe']
        .map(key => ({ [key]: 'not-a-date' })),
      { assistantId: '00000000-0000-1000-8000-000000000001' },
      { status: 'ended' }, { metadata: { customer: 'test' } }, { cursor: 'unknown' }, { page: 2 },
    ];
    for (const args of invalid) {
      expect((await client.callTool({ name: 'list_calls', arguments: args })).isError).toBe(true);
    }
    expect(list).not.toHaveBeenCalled();
  });
});
