import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import { Ajv } from 'ajv';
import { DEFAULT_VOICE, DEFAULT_TRANSCRIBER } from '../schemas/index.js';
import {
  VoiceInputSchema, TranscriberInputSchema, CreateAssistantNameSchema,
  UpdateAssistantNameSchema, providerContract, providersRequiringExpandedInputs,
} from '../schemas/assistant-openapi.js';

describe.each([
  { field: 'voice' as const, validator: VoiceInputSchema },
  { field: 'transcriber' as const, validator: TranscriberInputSchema },
])('$field OpenAPI-to-Zod parity', ({ field, validator }) => {
  test('agrees with independent JSON Schema validation for every supported provider', () => {
    const contract = providerContract(field);
    const reference = new Ajv({ strict: false, allErrors: true }).compile(contract);
    const cases: unknown[] = [null, {}, { provider: 'unknown' }];
    for (const branch of contract.oneOf ?? []) {
      const properties = branch.properties as Record<string, { enum?: string[] }>;
      const base: Record<string, unknown> = { provider: properties.provider.enum![0] };
      if (properties.voiceId) base.voiceId = properties.voiceId.enum?.[0] ?? 'external-voice-id';
      if (branch.required?.includes('model')) base.model = properties.model.enum![0];
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
  });
});

test('MCP create defaults remain valid against the imported provider contracts', () => {
  expect(VoiceInputSchema.parse(DEFAULT_VOICE)).toEqual(DEFAULT_VOICE);
  expect(TranscriberInputSchema.parse(DEFAULT_TRANSCRIBER)).toEqual(DEFAULT_TRANSCRIBER);
});
