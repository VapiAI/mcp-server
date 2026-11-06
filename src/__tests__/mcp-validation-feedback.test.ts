import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { registerAllTools } from '../tools/index.js';

const toolId = '00000000-0000-4000-8000-000000000004';
const operation = jest.fn(async () => ({
  id: toolId, createdAt: '', updatedAt: '', type: 'function',
  function: { name: 'test_tool' }, server: { url: 'https://example.test' },
}));
let client: Client;
let server: McpServer;
beforeAll(async () => {
  server = new McpServer({ name: 'validation-feedback', version: '0' });
  const methods = { get: operation, create: operation, update: operation, list: jest.fn(async () => []) };
  registerAllTools(server, { assistants: methods, calls: methods, phoneNumbers: methods, tools: methods } as unknown as VapiClient);
  client = new Client({ name: 'validation-feedback-client', version: '0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
});
afterAll(async () => { await client.close(); await server.close(); });
beforeEach(() => { operation.mockClear(); });

test.each([
  { name: 'create_assistant', args: { name: 'Test', voice: { provider: 'vapi', voiceId: 'Elliot', model: 'foreign-model' } } },
  { name: 'create_tool', args: { type: 'function', name: 'weather', function: {
    parameters: { type: 'object', properties: { city: { type: 'not-a-type' } } },
    server: { url: 'https://example.test' },
  } } },
])('$name retains full validation for details omitted from tools/list', async ({ name, args }) => {
  const advertised = (await client.listTools()).tools.find(tool => tool.name === name)!;
  const ajv = new Ajv({ strict: false });
  addFormats.default(ajv);
  expect(ajv.compile(advertised.inputSchema)(args)).toBe(true);
  const response = await client.callTool({ name, arguments: args });
  expect(response.isError).toBe(true);
  expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({ code: 'INVALID_ARGUMENTS' }) });
  expect(operation).not.toHaveBeenCalled();
});

test.each([
  { name: 'create_call', args: { scheduledAt: 'tomorrow' }, path: 'scheduledAt' },
  { name: 'create_tool', args: { type: 'apiRequest', apiRequest: { url: 'https://example.test', timeoutSeconds: 301 } }, path: 'apiRequest.timeoutSeconds' },
  { name: 'create_assistant', args: { name: 'Test', voice: { provider: 'vapi', voiceId: 'Elliot', model: 'foreign-model' } }, path: 'voice.model' },
])('$name returns a corrective field path without making an API call', async ({ name, args, path }) => {
  const response = await client.callTool({ name, arguments: args });
  expect(response.isError).toBe(true);
  expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
    code: 'INVALID_ARGUMENTS', tool: name,
    issues: expect.arrayContaining([expect.objectContaining({ path, ...(path === 'apiRequest.timeoutSeconds' ? { maximum: 300 } : {}) })]),
  }) });
  expect(operation).not.toHaveBeenCalled();
});

test('an agent can correct a reported field and retry successfully', async () => {
  const invalid = await client.callTool({ name: 'get_tool', arguments: { toolId: 'not-a-uuid' } });
  expect(invalid.isError).toBe(true);
  expect(invalid.structuredContent).toEqual({ validationError: expect.objectContaining({
    issues: expect.arrayContaining([expect.objectContaining({ path: 'toolId', code: 'invalid_format' })]),
  }) });
  expect(operation).not.toHaveBeenCalled();
  const corrected = await client.callTool({ name: 'get_tool', arguments: { toolId } });
  expect(corrected.isError).not.toBe(true);
  expect(operation).toHaveBeenCalledTimes(1);
});

test('malformed LLM JSON errors do not echo submitted secret values', async () => {
  const secret = 'private-value-should-never-appear';
  const response = await client.callTool({ name: 'create_assistant', arguments: { name: 'Test', llm: `{ "token": "${secret}"` } });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain(secret);
  expect(JSON.stringify(response.content)).toContain('Invalid JSON');
  expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
    issues: expect.arrayContaining([expect.objectContaining({ path: 'llm' })]),
  }) });
  expect(operation).not.toHaveBeenCalled();
});

test.each([{ provider: 'unknown-provider', voiceId: 'Elliot' }, { voiceId: 'Elliot' }])('provider errors are bounded and locate missing or unknown discriminators: %j', async voice => {
  const response = await client.callTool({ name: 'create_assistant', arguments: {
    name: 'Test', voice,
  } });
  expect(response.isError).toBe(true);
  expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
    issues: [expect.objectContaining({ path: 'voice.provider', code: 'invalid_value', allowedValues: expect.any(Array), allowedValuesTruncated: true })],
  }) });
  expect(JSON.stringify(response).length).toBeLessThan(3000);
  expect(operation).not.toHaveBeenCalled();
});

test('invalid header values do not leak credential contents', async () => {
  const secret = 'private-header-value-never-echo';
  const response = await client.callTool({ name: 'create_tool', arguments: {
    type: 'apiRequest', apiRequest: { url: 'https://example.test', headers: { Authorization: { token: secret } } },
  } });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain(secret);
  expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
    issues: expect.arrayContaining([expect.objectContaining({ path: 'apiRequest.headers.Authorization' })]),
  }) });
  expect(operation).not.toHaveBeenCalled();
});

test('large failures report at most twelve issues and indicate truncation', async () => {
  const response = await client.callTool({ name: 'create_tool', arguments: {
    type: 'transferCall', transferCall: { destinations: Array.from({ length: 30 }, () => ({ type: 'number', number: 42 })) },
  } });
  const details = response.structuredContent as { validationError: { issues: unknown[]; truncated: boolean } };
  expect(response.isError).toBe(true);
  expect(details.validationError.issues).toHaveLength(12);
  expect(details.validationError.truncated).toBe(true);
  expect(operation).not.toHaveBeenCalled();
});

test('unsupported tool types report the supported choices', async () => {
  const response = await client.callTool({ name: 'create_tool', arguments: { type: 'unknown' } });
  expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
    issues: [expect.objectContaining({ path: 'type', allowedValues: expect.arrayContaining(['sms', 'transferCall', 'function', 'apiRequest']) })],
  }) });
  expect(operation).not.toHaveBeenCalled();
});

test('JSON-string provider errors identify the nested provider field', async () => {
  const response = await client.callTool({ name: 'create_assistant', arguments: {
    name: 'Test', llm: JSON.stringify({ provider: 'unknown-provider', model: 'private-input-value' }),
  } });
  expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
    issues: [expect.objectContaining({ path: 'llm.provider', code: 'invalid_value' })],
  }) });
  expect(JSON.stringify(response)).not.toContain('private-input-value');
  expect(operation).not.toHaveBeenCalled();
});
