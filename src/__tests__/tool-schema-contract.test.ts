import { describe, expect, test } from '@jest/globals';
import {
  CallInputSchema, CreateToolInputSchema, UpdateToolInputSchema,
  GetAssistantInputSchema, GetCallInputSchema, GetPhoneNumberInputSchema, GetToolInputSchema,
} from '../schemas/index.js';
import { transformCallInput, transformToolInput, transformUpdateToolInput } from '../transformers/index.js';

const assistantId = '00000000-0000-4000-8000-000000000001';
const callId = '00000000-0000-4000-8000-000000000002';
const phoneNumberId = '00000000-0000-4000-8000-000000000003';
const toolId = '00000000-0000-4000-8000-000000000004';

test('call fields preserve the schedule alias and dynamic variables in the API payload', () => {
  const scheduledAt = '2030-01-01T12:00:00.000Z';
  const input = {
    assistantId, phoneNumberId, customer: { number: '+15555550100' }, scheduledAt,
    assistantOverrides: { variableValues: { name: 'Joe', age: 24, active: true, nested: { count: 2 } } },
  };
  const parsed = CallInputSchema.parse(input);
  expect(parsed).toEqual(input);
  expect(transformCallInput(parsed)).toEqual({
    assistantId, phoneNumberId, customer: input.customer,
    schedulePlan: { earliestAt: scheduledAt }, assistantOverrides: input.assistantOverrides,
  });
});

test.each([
  { customer: { number: 42 } }, { scheduledAt: 42 },
  { assistantId: null }, { phoneNumberId: 42 },
  { assistantOverrides: { variableValues: 'not-an-object' } },
])('call schema rejects malformed fields: %j', input => {
  expect(CallInputSchema.safeParse(input).success).toBe(false);
});

test.each([
  { scheduledAt: 'tomorrow' },
  { customer: { number: '12' } },
  { customer: { number: '1'.repeat(41) } },
])('call inputs enforce published constraints: %j', input => {
  expect(CallInputSchema.safeParse(input).success).toBe(false);
});

describe.each([
  { schema: GetAssistantInputSchema, key: 'assistantId', id: assistantId },
  { schema: GetCallInputSchema, key: 'callId', id: callId },
  { schema: GetPhoneNumberInputSchema, key: 'phoneNumberId', id: phoneNumberId },
  { schema: GetToolInputSchema, key: 'toolId', id: toolId },
])('$key lookup contract', ({ schema, key, id }) => {
  test('preserves the identifier alias', () => {
    expect(schema.parse({ [key]: id })).toEqual({ [key]: id });
  });
  test.each([{}, { [key]: null }, { [key]: 42 }])('rejects a missing or malformed identifier: %j', input => {
    expect(schema.safeParse(input).success).toBe(false);
  });
  test('rejects an identifier outside the API UUID format', () => {
    expect(schema.safeParse({ [key]: 'not-a-uuid' }).success).toBe(false);
  });
});

const parameters = { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] };
const configurations = [
  {
    input: { type: 'sms', name: 'send_sms', sms: { metadata: { from: '+15555550100' } } },
    dto: { type: 'sms', function: { name: 'send_sms' }, metadata: { from: '+15555550100' } },
  },
  {
    input: { type: 'transferCall', name: 'transfer', transferCall: { destinations: [{ type: 'number', number: '+15555550100' }] } },
    dto: { type: 'transferCall', function: { name: 'transfer' }, destinations: [{ type: 'number', number: '+15555550100' }] },
  },
  {
    input: { type: 'function', name: 'weather', function: { parameters, server: { url: 'https://example.test/tool', headers: { 'X-Region': 'us' } } } },
    dto: { type: 'function', function: { name: 'weather', parameters }, server: { url: 'https://example.test/tool', headers: { 'X-Region': 'us' } } },
  },
  {
    input: { type: 'apiRequest', name: 'weather', apiRequest: { url: 'https://example.test/weather', headers: { 'X-Region': 'us' }, body: parameters, backoffPlan: {} } },
    dto: { type: 'apiRequest', function: { name: 'weather' }, url: 'https://example.test/weather', method: 'POST', headers: { 'X-Region': 'us' }, body: parameters, timeoutSeconds: 20, backoffPlan: { type: 'fixed', maxRetries: 3, baseDelaySeconds: 1 } },
  },
];

test.each(configurations)('custom-tool creation preserves the $input.type mapping and MCP defaults', ({ input, dto }) => {
  expect(transformToolInput(CreateToolInputSchema.parse(input))).toEqual(dto);
});

test('sparse tool updates do not inject create configuration defaults', () => {
  const input = { toolId, name: 'renamed_tool' };
  expect(UpdateToolInputSchema.parse(input)).toEqual(input);
  expect(transformUpdateToolInput(UpdateToolInputSchema.parse(input))).toEqual({ function: { name: 'renamed_tool' } });
});

test('update tool identifiers use the API UUID format', () => {
  expect(UpdateToolInputSchema.safeParse({ toolId: 'not-a-uuid' }).success).toBe(false);
});

test.each(['PUT', 'PATCH', 'DELETE'])('API request tools accept the published %s method', method => {
  expect(CreateToolInputSchema.safeParse({ type: 'apiRequest', apiRequest: { url: 'https://example.test', method } }).success).toBe(true);
});

test.each([
  { type: 'unknown' },
  { type: 'apiRequest', apiRequest: { url: 42 } },
  { type: 'apiRequest', apiRequest: { url: 'https://example.test', headers: { Authorization: 42 } } },
  { type: 'function', function: { parameters, server: { url: 'not-a-url' } } },
  { type: 'transferCall', transferCall: { destinations: [{ type: 'number', number: 42 }] } },
])('custom-tool schema rejects malformed configuration: %j', input => {
  expect(CreateToolInputSchema.safeParse(input).success).toBe(false);
});

test.each([
  { type: 'apiRequest', apiRequest: { url: 'https://example.test', timeoutSeconds: 301 } },
  { type: 'apiRequest', apiRequest: { url: 'https://example.test', timeoutSeconds: 0 } },
  { type: 'apiRequest', apiRequest: { url: 'https://example.test', backoffPlan: { maxRetries: 11 } } },
  { type: 'apiRequest', apiRequest: { url: 'https://example.test', backoffPlan: { baseDelaySeconds: -1 } } },
  { type: 'transferCall', transferCall: { destinations: [{ type: 'number', number: '+15555550100', extension: '1'.repeat(11) }] } },
  { type: 'function', name: 'invalid name with spaces' },
  { type: 'apiRequest' },
  { type: 'function', function: { parameters: { type: 'object', properties: {} }, server: { url: 'https://example.test' } } },
])('tool inputs enforce published constraints: %j', input => {
  expect(CreateToolInputSchema.safeParse(input).success).toBe(false);
});
