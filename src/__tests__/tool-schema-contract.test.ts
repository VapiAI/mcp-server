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

test.each([
  { type: 'sms' }, { type: 'dtmf', sipInfoDtmfEnabled: true }, { type: 'endCall' },
  { type: 'transferCall', destinations: [{ type: 'number', number: '+15555550100' }] },
  { type: 'function', function: { name: 'weather', parameters: { type: 'object', properties: {} } }, server: { url: 'https://example.test' } },
  { type: 'apiRequest', method: 'GET', url: 'https://example.test' },
  { type: 'google.sheets.row.append' },
])('tool creation preserves API fields and omitted defaults: %j', input => {
  expect(transformToolInput(CreateToolInputSchema.parse(input))).toEqual(input);
});

test('sparse updates retain API nesting', () => {
  expect(transformUpdateToolInput(UpdateToolInputSchema.parse({ id: toolId, function: { description: 'Changed' } })))
    .toEqual({ function: { description: 'Changed' } });
});

test.each([
  { type: 'unknown' }, { type: 'apiRequest', method: 'GET' },
  { type: 'apiRequest', method: 'GET', url: 'https://example.test', timeoutSeconds: 301 },
  { type: 'function', function: { name: 'invalid name with spaces' } },
  { type: 'dtmf', sipInfoDtmfEnabled: 'true' },
  { type: 'endCall', messages: [{ type: 'request-start', content: 'x'.repeat(1001) }] },
  { type: 'endCall', rejectionPlan: { conditions: [{ type: 'liquid' }] } },
])('API tool contracts reject malformed fields: %j', input => {
  expect(CreateToolInputSchema.safeParse(input).success).toBe(false);
});
