import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { DEFAULT_VOICE, DEFAULT_TRANSCRIBER } from '../schemas/index.js';
import {
  VoiceInputSchema, TranscriberInputSchema, CreateAssistantNameSchema,
  UpdateAssistantNameSchema, LLMInputSchema, apiField, fieldContract, providerContract, providersRequiringExpandedInputs,
} from '../schemas/assistant-openapi.js';

describe.each([
  { field: 'voice' as const, validator: VoiceInputSchema },
  { field: 'transcriber' as const, validator: TranscriberInputSchema },
  { field: 'llm' as const, validator: LLMInputSchema },
])('$field OpenAPI-to-Zod parity', ({ field, validator }) => {
  test('agrees with independent JSON Schema validation for every supported provider', () => {
    const contract = providerContract(field);
    const reference = new Ajv({ strict: false, allErrors: true }).compile(contract);
    const cases: unknown[] = [null, {}, { provider: 'unknown' }];
    for (const branch of contract.oneOf ?? []) {
      const properties = branch.properties as Record<string, { enum?: string[] }>;
      const base: Record<string, unknown> = { provider: properties.provider.enum![0] };
      if (properties.voiceId) base.voiceId = properties.voiceId.enum?.[0] ?? 'external-voice-id';
      if (branch.required?.includes('model')) base.model = properties.model.enum?.[0] ?? 'test-model';
      expect(reference(base)).toBe(true);
      expect(validator.safeParse(base).success).toBe(true);
      cases.push(base, { ...base, model: null }, { ...base, model: 123 }, { ...base, unexpectedField: true });
      for (const key of branch.required ?? []) {
        const missing = { ...base };
        delete missing[key];
        cases.push(missing);
      }
      for (const value of properties.model?.enum ?? []) cases.push({ ...base, model: value });
    }
    for (const input of cases) {
      expect({ input, accepted: validator.safeParse(input).success }).toEqual({ input, accepted: reference(input) });
    }
  });
});

test('name validation agrees with the published constraints for create and update', () => {
  const source = JSON.parse(readFileSync(new URL('../schemas/assistant-openapi.json', import.meta.url), 'utf8'));
  for (const [operation, schema] of [['create', CreateAssistantNameSchema], ['update', UpdateAssistantNameSchema]] as const) {
    const reference = new Ajv({ strict: false }).compile(source.name[operation]);
    for (const input of [null, 42, '', 'x'.repeat(40), 'x'.repeat(41), '😀'.repeat(40), '😀'.repeat(41)]) {
      expect({ input, accepted: schema.safeParse(input).success }).toEqual({ input, accepted: reference(input) });
    }
  }
});

test('projection does not relax providers that require fields outside the current MCP interface', () => {
  expect(providersRequiringExpandedInputs).toEqual({
    voice: ['CustomVoice', 'NeuphonicVoice'],
    transcriber: ['CustomTranscriber', 'SpeechmaticsTranscriber'],
    llm: ['CustomLLMModel'],
  });
});

const fieldCases: Record<string, unknown[]> = {
  assistantId: ['00000000-0000-4000-8000-000000000001', 'bad-id', null],
  callId: ['00000000-0000-4000-8000-000000000002', 'bad-id', 42],
  phoneNumberId: ['00000000-0000-4000-8000-000000000003', 'bad-id', null],
  toolId: ['00000000-0000-4000-8000-000000000004', 'bad-id', null],
  scheduledAt: ['2030-01-01T12:00:00.000Z', '2030-01-01T12:00:00+05:00', 'tomorrow', null],
  customerNumber: ['+15555550100', '12', 'x'.repeat(41), 42],
  functionName: ['valid_tool-name', 'bad name', 'x'.repeat(65)],
  apiTimeout: [0, 1, 300, 301, '20'],
  backoffType: ['fixed', 'exponential', 'invalid', {}],
  backoffMaxRetries: [-1, 0, 10, 11],
  backoffDelay: [-1, 0, 10, 11],
  apiMethod: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'INVALID'],
  functionParameters: [
    { type: 'object', properties: { city: { type: 'string', pattern: '[a-z]+' } } },
    { type: 'object', properties: { bad: { type: 'not-a-type' } } },
    { type: 'object', properties: null },
  ],
  apiBody: [{ type: 'array', items: { type: 'integer' } }, { type: 'object', properties: { nested: { type: 'object', properties: { flag: { type: 'boolean' } } } } }, { type: 'not-a-type' }],
  transferDestination: [{ type: 'number', number: '+15555550100' }, { type: 'number', number: '12' }, { type: 'number', number: '+15555550100', extension: 'x'.repeat(11) }],
};
test.each(Object.entries(fieldCases))('%s agrees with independent JSON Schema validation', (name, values) => {
  const ajv = new Ajv({ strict: false });
  addFormats.default(ajv);
  const reference = ajv.compile(fieldContract(name));
  const schema = apiField(name);
  for (const input of values) {
    expect({ input, accepted: schema.safeParse(input).success }).toEqual({ input, accepted: reference(input) });
  }
});

test('MCP create defaults remain valid against the imported provider contracts', () => {
  expect(VoiceInputSchema.parse(DEFAULT_VOICE)).toEqual(DEFAULT_VOICE);
  expect(TranscriberInputSchema.parse(DEFAULT_TRANSCRIBER)).toEqual(DEFAULT_TRANSCRIBER);
});
