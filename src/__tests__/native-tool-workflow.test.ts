import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';
import { parseToolResponse } from '../utils/response.js';

const assistantId = '00000000-0000-4000-8000-000000000001';
const toolIds = {
  dtmf: '00000000-0000-4000-8000-000000000002',
  endCall: '00000000-0000-4000-8000-000000000003',
};
const timestamp = '2026-01-01T00:00:00.000Z';
const originalAssistant = {
  id: assistantId,
  createdAt: timestamp,
  updatedAt: timestamp,
  name: 'Native tool assistant',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.4,
    messages: [{ role: 'system', content: 'Keep the existing prompt.' }],
    toolIds: ['00000000-0000-4000-8000-000000000009'],
  },
  voice: { provider: '11labs', voiceId: 'sarah' },
  transcriber: { provider: 'deepgram' },
};

const nativeTools: Record<string, Record<string, unknown>> = {};
const createTool = jest.fn(async (dto: Record<string, unknown>) => {
  const tool = { ...dto, id: toolIds[String(dto.type) as keyof typeof toolIds] ?? '00000000-0000-4000-8000-000000000004', createdAt: timestamp, updatedAt: timestamp };
  nativeTools[String(tool.id)] = tool;
  return tool;
});
const getTool = jest.fn(async ({ id }: { id: string }) => nativeTools[id]);
const updateTool = jest.fn(async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
  const tool = { ...nativeTools[id], ...body, updatedAt: timestamp };
  nativeTools[id] = tool;
  return tool;
});
let savedAssistant = structuredClone(originalAssistant);
const getAssistant = jest.fn(async () => structuredClone(savedAssistant));
const updateAssistant = jest.fn(async (dto: { id: string; model: Record<string, unknown> }) => {
  savedAssistant = { ...savedAssistant, model: { ...savedAssistant.model, ...dto.model } };
  return structuredClone(savedAssistant);
});

let client: Client;
let server: McpServer;
beforeAll(async () => {
  server = new McpServer({ name: 'native-tool-workflow', version: '0' });
  const methods = { list: jest.fn(async () => []), get: getTool, create: createTool, update: updateTool };
  const assistantMethods = { list: jest.fn(async () => []), get: getAssistant, create: jest.fn(async () => originalAssistant), update: updateAssistant };
  registerAllTools(server, {
    assistants: assistantMethods,
    calls: methods,
    phoneNumbers: methods,
    tools: methods,
  } as unknown as VapiClient);
  client = new Client({ name: 'native-tool-workflow-client', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterAll(async () => { await client.close(); await server.close(); });
beforeEach(() => {
  savedAssistant = structuredClone(originalAssistant);
  createTool.mockClear(); getTool.mockClear(); updateTool.mockClear();
  getAssistant.mockClear(); updateAssistant.mockClear();
});

async function invoke(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  expect(response.isError).not.toBe(true);
  return parseToolResponse(response);
}

test.each([
  {
    type: 'dtmf',
    config: { messages: [{ type: 'request-start', content: 'Entering the account number.' }], sipInfoDtmfEnabled: true, rejectionPlan: { conditions: [{ type: 'regex', regex: 'not authorized' }] } },
  },
  {
    type: 'endCall',
    config: { messages: [{ type: 'request-start', content: 'Goodbye.' }], rejectionPlan: { conditions: [{ type: 'liquid', liquid: 'true' }] } },
  },
])('create, attach, and inspect the $type tool through registered MCP tools', async ({ type, config }) => {
  const created = await invoke('create_tool', { type, ...config });
  const toolId = toolIds[type as keyof typeof toolIds];
  expect(createTool).toHaveBeenCalledWith({ type, ...config });
  expect(created).toMatchObject({ id: toolId, type });

  const attached = await invoke('update_assistant', { assistantId, toolIds: [...originalAssistant.model.toolIds, toolId] });
  expect(getAssistant).toHaveBeenCalledWith({ id: assistantId });
  expect(updateAssistant).toHaveBeenCalledWith({
    id: assistantId,
    model: {
      ...originalAssistant.model,
      toolIds: [...originalAssistant.model.toolIds, toolId],
    },
  });
  expect(attached.toolIds).toEqual([...originalAssistant.model.toolIds, toolId]);
  const fetched = await invoke('get_assistant', { assistantId });
  expect(fetched.toolIds).toEqual([...originalAssistant.model.toolIds, toolId]);
  expect(savedAssistant).toEqual({ ...originalAssistant, model: { ...originalAssistant.model, toolIds: [...originalAssistant.model.toolIds, toolId] } });

  const inspected = await invoke('get_tool', { toolId });
  expect(getTool).toHaveBeenCalledWith({ id: toolId });
  expect(inspected).toMatchObject({ type });
});

test.each([
  { type: 'dtmf', sipInfoDtmfEnabled: 'true' },
  { type: 'endCall', messages: [{ type: 'wrong-message-type' }] },
])('rejects invalid native tool input before API dispatch: %j', async args => {
  const response = await client.callTool({ name: 'create_tool', arguments: args });
  expect(response.isError).toBe(true);
  expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({ code: 'INVALID_ARGUMENTS' }) });
  expect(createTool).not.toHaveBeenCalled();
});

test.each([
  { type: 'sms', name: 'send_sms', sms: { metadata: { from: '+15555550100' } } },
  { type: 'transferCall', name: 'transfer', transferCall: { destinations: [{ type: 'number', number: '+15555550100' }] } },
  { type: 'function', name: 'lookup', function: { parameters: { type: 'object', properties: {} }, server: { url: 'https://example.test/tool' } } },
  { type: 'apiRequest', name: 'lookup', apiRequest: { url: 'https://example.test/tool' } },
])('existing tool type $type still creates through MCP', async args => {
  await invoke('create_tool', args);
  expect(createTool).toHaveBeenCalledTimes(1);
  expect(createTool).toHaveBeenCalledWith(expect.objectContaining({ type: args.type }));
});

test.each([
  { type: 'dtmf', update: { sipInfoDtmfEnabled: false } },
  { type: 'endCall', update: { messages: [{ type: 'request-start', content: 'Farewell.' }] } },
])('native $type update sends options to Vapi and inspection returns the updated settings', async ({ type, update }) => {
  const toolId = toolIds[type as keyof typeof toolIds];
  await invoke('update_tool', { toolId, ...update });
  expect(getTool).toHaveBeenCalledWith({ id: toolId });
  expect(updateTool).toHaveBeenCalledWith({ id: toolId, body: update });
  const inspected = await invoke('get_tool', { toolId });
  expect(inspected).toMatchObject({ type });
  expect(nativeTools[toolId]).toMatchObject(update);
});

test.each([
  { type: 'dtmf', transferCall: { destinations: [{ type: 'number', number: '+15555550100' }] } },
  { type: 'endCall', apiRequest: { url: 'https://example.test' } },
])('rejects incompatible native create input', async args => {
  const response = await client.callTool({ name: 'create_tool', arguments: args });
  expect(response.isError).toBe(true);
  expect(createTool).not.toHaveBeenCalled();
});

test.each([
  { toolId: toolIds.dtmf, transferCall: { destinations: [{ type: 'number', number: '+15555550100' }] } },
  { toolId: toolIds.endCall, sipInfoDtmfEnabled: true },
  { toolId: '00000000-0000-4000-8000-000000000004', sipInfoDtmfEnabled: true },
])('rejects incompatible updates before mutation', async args => {
  nativeTools[toolIds.dtmf] = { type: 'dtmf' };
  nativeTools[toolIds.endCall] = { type: 'endCall' };
  nativeTools['00000000-0000-4000-8000-000000000004'] = { type: 'function' };
  const result = parseToolResponse(await client.callTool({ name: 'update_tool', arguments: args }));
  expect(result.error).toBeDefined();
  expect(updateTool).not.toHaveBeenCalled();
});
