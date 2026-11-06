import { expect, test } from '@jest/globals';
import {
  CallInputSchema, CreateToolInputSchema, UpdateToolInputSchema,
  CreateAssistantInputSchema, GetAssistantInputSchema, GetCallInputSchema,
  GetPhoneNumberInputSchema, GetToolInputSchema,
} from '../schemas/index.js';

test.each([GetAssistantInputSchema, GetCallInputSchema, GetPhoneNumberInputSchema, GetToolInputSchema])(
  'lookup identifiers use the API UUID format', schema => {
    const key = Object.keys(schema.shape)[0];
    expect(schema.safeParse({ [key]: 'not-a-uuid' }).success).toBe(false);
  }
);

test.each([
  { scheduledAt: 'tomorrow' },
  { customer: { number: '12' } },
  { customer: { number: '1'.repeat(41) } },
])('call inputs enforce published constraints: %j', input => {
  expect(CallInputSchema.safeParse(input).success).toBe(false);
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

test('update tool identifiers use the API UUID format', () => {
  expect(UpdateToolInputSchema.safeParse({ toolId: 'not-a-uuid' }).success).toBe(false);
});

test.each(['PUT', 'PATCH', 'DELETE'])('API request tools accept the published %s method', method => {
  expect(CreateToolInputSchema.safeParse({ type: 'apiRequest', apiRequest: { url: 'https://example.test', method } }).success).toBe(true);
});

test.each([
  { provider: 'unknown', model: 'anything' },
  JSON.stringify({ provider: 'unknown', model: 'anything' }),
])('LLM inputs validate their provider after decoding JSON: %j', llm => {
  expect(CreateAssistantInputSchema.safeParse({ name: 'LLM check', llm }).success).toBe(false);
});
