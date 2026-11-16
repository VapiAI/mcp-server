import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';
import { parseToolResponse } from '../utils/response.js';
import { toolOperations, toolExamples, validateToolUpdate } from '../schemas/tool-openapi.js';
import { CreateToolInputSchema } from '../schemas/index.js';

const id = '00000000-0000-4000-8000-000000000007';
const base: Record<string, Record<string, unknown>> = {
  apiRequest: { method: 'GET', url: 'https://example.test/data' },
  code: { code: 'return { ok: true };' },
  bash: { subType: 'bash_20241022', name: 'bash' },
  computer: { subType: 'computer_20241022', name: 'computer', displayWidthPx: 800, displayHeightPx: 600 },
  textEditor: { subType: 'text_editor_20241022', name: 'str_replace_editor' },
  sipRequest: { verb: 'INFO' },
};
let saved: Record<string, unknown>;
const create = jest.fn(async (body: Record<string, unknown>) => { saved = { ...body, id, createdAt: '', updatedAt: '' }; return saved; });
const update = jest.fn(async ({ body }: { body: Record<string, unknown> }) => { saved = { ...saved, ...body }; return saved; });
const get = jest.fn(async () => saved);
const fetch = jest.fn(async () => { throw new Error('Bundled lookup must not fetch live schema'); });
let server: McpServer;
let client: Client;
beforeAll(async () => {
  server = new McpServer({ name: 'api-tool-variants', version: '0' });
  const methods = { create, update, get, list: jest.fn(async () => []) };
  registerAllTools(server, { tools: methods, assistants: methods, calls: methods, phoneNumbers: methods, fetch } as unknown as VapiClient);
  client = new Client({ name: 'api-tool-variants-client', version: '0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
});
afterAll(async () => { await client.close(); await server.close(); });

// All branches are taken from the endpoint union, including code (absent from
// its published discriminator mapping) and update-only knowledgeBase.
test.each(Object.keys(toolOperations.create_tool))('registered MCP creates API variant %s', async type => {
  const input = { type, ...base[type] };
  const response = await client.callTool({ name: 'create_tool', arguments: input });
  expect(response.isError).not.toBe(true);
  expect(parseToolResponse(response).error).toBeUndefined();
  expect(create).toHaveBeenLastCalledWith(input);
});
test.each(Object.keys(toolOperations.update_tool))('registered MCP updates API variant %s', async type => {
  saved = { id, type, createdAt: '', updatedAt: '', ...base[type] };
  const response = await client.callTool({ name: 'update_tool', arguments: { id, messages: [] } });
  expect(response.isError).not.toBe(true);
  expect(parseToolResponse(response).error).toBeUndefined();
  expect(update).toHaveBeenLastCalledWith({ id, body: { messages: [] } });
});
test('discovery lists bundled types and resolves their exact DTO and referenced examples without network', async () => {
  const catalog = parseToolResponse(await client.callTool({ name: 'get_api_schema', arguments: { tool: 'create_tool' } }));
  expect(catalog.types).toContainEqual({ type: 'google.sheets.row.append', schema: 'CreateGoogleSheetsRowAppendToolDTO' });
  expect(catalog.types).toHaveLength(Object.keys(toolOperations.create_tool).length);
  const details = parseToolResponse(await client.callTool({ name: 'get_api_schema', arguments: { tool: 'create_tool', name: 'CreateFunctionToolDTO' } }));
  expect(details.schema.properties.function).toBeDefined();
  expect(details.referencedSchemas).toContain('OpenAIFunction');
  expect(details.examples).toEqual(toolExamples.CreateFunctionToolDTO);
  const nested = parseToolResponse(await client.callTool({ name: 'get_api_schema', arguments: { tool: 'create_tool', name: 'ToolRejectionPlan' } }));
  expect(nested.schema.properties.conditions.examples.length).toBeGreaterThan(0);
  expect(fetch).not.toHaveBeenCalled();
});
test('every progressively disclosed worked request validates against the bundled API', () => {
  for (const examples of Object.values(toolExamples)) for (const example of examples) {
    expect(CreateToolInputSchema.parse(example)).toEqual(example);
  }
});
test('sparse function/server updates preserve configuration while allowing explicit replacements', async () => {
  saved = { id, type: 'function', createdAt: '', updatedAt: '', function: { name: 'lookup', description: 'Old', parameters: { type: 'object', properties: {} } }, server: { url: 'https://example.test', headers: { Authorization: 'fake' }, timeoutSeconds: 12 } };
  await client.callTool({ name: 'update_tool', arguments: { id, function: { description: 'New' }, server: { timeoutSeconds: 25 } } });
  expect(saved.function).toMatchObject({ name: 'lookup', description: 'New', parameters: { type: 'object', properties: {} } });
  expect(saved.server).toEqual({ url: 'https://example.test', headers: { Authorization: 'fake' }, timeoutSeconds: 25 });
});
test('unknown extension fields are preserved according to the published open object contract', () => {
  const input = { type: 'dtmf', extensionField: { nested: 'value' } };
  expect(CreateToolInputSchema.parse(input)).toEqual(input);
});
test('request type changes and invalid nested updates are rejected', () => {
  expect(() => validateToolUpdate('dtmf', { type: 'endCall' })).toThrow();
  expect(() => validateToolUpdate('endCall', { messages: [{ type: 'request-start', content: 42 }] })).toThrow();
});
test('snapshot catalog exactly covers the saved endpoint unions', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../schemas/tool-openapi.json', import.meta.url), 'utf8'));
  for (const operation of ['create_tool', 'update_tool'] as const) {
    for (const [type, dto] of Object.entries(toolOperations[operation])) expect(snapshot.definitions[dto].properties.type.enum).toEqual([type]);
  }
});

test('real SDK preserves API tool payloads over a mocked HTTP transport', async () => {
  const { VapiClient } = await import('@vapi-ai/server-sdk');
  const { registerToolTools } = await import('../tools/tool.js');
  const requests: { url: string; method: string; body: unknown }[] = [];
  let state: Record<string, unknown> = {};
  const sdk = new VapiClient({ token: 'fake-token', fetch: async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body });
    if (method === 'POST') state = { ...body, id, createdAt: '', updatedAt: '' };
    if (method === 'PATCH') state = { ...state, ...body };
    return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const sdkServer = new McpServer({ name: 'sdk-wire', version: '0' });
  registerToolTools(sdkServer, sdk);
  const sdkClient = new Client({ name: 'sdk-wire-client', version: '0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await sdkServer.connect(st); await sdkClient.connect(ct);
  try {
    const payload = { type: 'code', code: 'return { ok: true };', messages: [{ type: 'request-start', content: 'Processing.' }] };
    const created = parseToolResponse(await sdkClient.callTool({ name: 'create_tool', arguments: payload }));
    expect(created.error).toBeUndefined();
    const updated = parseToolResponse(await sdkClient.callTool({ name: 'update_tool', arguments: { id, code: 'return { ok: false };' } }));
    expect(updated.error).toBeUndefined();
    expect(requests.map(r => [new URL(r.url).pathname, r.method, r.body])).toEqual([
      ['/tool', 'POST', payload],
      [`/tool/${id}`, 'GET', undefined],
      [`/tool/${id}`, 'PATCH', { code: 'return { ok: false };' }],
    ]);
    expect(state.messages).toEqual(payload.messages);
  } finally { await sdkClient.close(); await sdkServer.close(); }
});
