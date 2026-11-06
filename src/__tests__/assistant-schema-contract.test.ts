import { describe, expect, test } from '@jest/globals';
import type { Vapi } from '@vapi-ai/server-sdk';
import { CreateAssistantInputSchema, UpdateAssistantInputSchema } from '../schemas/index.js';
import { transformAssistantOutput, transformAssistantInput, transformUpdateAssistantInput } from '../transformers/index.js';

const configurations = [
  {
    voice: { provider: '11labs', voiceId: 'sarah', model: 'eleven_turbo_v2_5' },
    transcriber: { provider: 'deepgram', model: 'nova-3' },
  },
  {
    voice: { provider: 'openai', voiceId: 'alloy', model: 'tts-1' },
    transcriber: { provider: 'openai', model: 'gpt-4o-transcribe' },
  },
  {
    voice: { provider: 'vapi', voiceId: 'Elliot' },
    transcriber: { provider: 'deepgram', model: 'nova-3' },
  },
];

describe.each([
  { operation: 'create', schema: CreateAssistantInputSchema, base: { name: 'Schema contract' } },
  { operation: 'update', schema: UpdateAssistantInputSchema, base: { assistantId: '00000000-0000-4000-8000-000000000001' } },
])('$operation assistant schema contract', ({ operation, schema, base }) => {
  test.each(configurations)('preserves valid provider configuration: %j', configuration => {
    const parsed = schema.parse({ ...base, ...configuration });
    expect(parsed.voice).toEqual(configuration.voice);
    expect(parsed.transcriber).toEqual(configuration.transcriber);
    const dto = operation === 'create'
      ? transformAssistantInput(CreateAssistantInputSchema.parse({ name: 'Schema contract', ...configuration }))
      : transformUpdateAssistantInput(UpdateAssistantInputSchema.parse({ assistantId: '00000000-0000-4000-8000-000000000001', ...configuration }));
    expect(dto.voice).toEqual(configuration.voice);
    expect(dto.transcriber).toEqual(configuration.transcriber);
  });

  test('accepts a name at the API boundary of 40 characters', () => {
    expect(schema.parse({ ...base, name: 'a'.repeat(40) }).name).toBe('a'.repeat(40));
  });

  test('rejects a 41-character name', () => {
    expect(schema.safeParse({ ...base, name: 'x'.repeat(41) }).success).toBe(false);
  });

  test.each([
    { voice: { provider: 'vapi', voiceId: 'Elliot', model: 'eleven_turbo_v2_5' } },
    { voice: { provider: 'vapi', voiceId: 'Elliot', model: null } },
    { voice: { provider: 'azure', voiceId: 'andrew', model: 'tts-1' } },
    { voice: { provider: 'sesame', voiceId: 'test-voice' } },
    { voice: { provider: '11labs', voiceId: 'sarah', model: 'tts-1' } },
    { transcriber: { provider: 'assembly-ai', model: 'nova-3' } },
    { transcriber: { provider: 'openai' } },
    { transcriber: { provider: 'unknown', model: 'nova-3' } },
  ])('rejects a provider/model mismatch: %j', invalid => {
    expect(schema.safeParse({ ...base, ...invalid }).success).toBe(false);
  });

  test.each(['assembly-ai', 'deepgram'])('accepts %s without inventing a model', provider => {
    const configuration = { voice: { provider: 'vapi', voiceId: 'Elliot' }, transcriber: { provider } };
    const parsed = schema.parse({ ...base, ...configuration });
    expect(parsed.voice).toEqual(configuration.voice);
    expect(parsed.transcriber).toEqual(configuration.transcriber);
    const create = transformAssistantInput(CreateAssistantInputSchema.parse({ name: 'Schema contract', ...configuration }));
    const update = transformUpdateAssistantInput(UpdateAssistantInputSchema.parse({ assistantId: '00000000-0000-4000-8000-000000000001', ...configuration }));
    expect(create.voice).toEqual(configuration.voice);
    expect(update.voice).toEqual(configuration.voice);
    expect(create.transcriber).toEqual({ provider });
    expect(update.transcriber).toEqual({ provider });
  });

  test.each([
    { name: null },
    { name: 42 },
    { voice: null },
    { voice: { provider: null, voiceId: 'Elliot' } },
    { voice: { provider: 'unknown', voiceId: 'Elliot' } },
    { voice: { provider: 'vapi' } },
    { voice: { provider: 'vapi', voiceId: 42 } },
    { transcriber: null },
    { transcriber: { model: 'nova-3' } },
    { transcriber: { provider: null, model: 'nova-3' } },
    { transcriber: { provider: 'deepgram', model: null } },
    { transcriber: { provider: 'deepgram', model: 42 } },
  ])('rejects malformed input: %j', invalid => {
    expect(schema.safeParse({ ...base, ...invalid }).success).toBe(false);
  });
});

test('create keeps MCP defaults and leaves an omitted firstMessageMode absent', () => {
  const parsed = CreateAssistantInputSchema.parse({ name: 'Schema contract' });
  expect(parsed.llm).toEqual({ provider: 'openai', model: 'gpt-4o' });
  expect(parsed.voice).toEqual({ provider: '11labs', voiceId: 'sarah' });
  expect(parsed.transcriber).toEqual({ provider: 'deepgram', model: 'nova-3' });
  expect(parsed.instructions).toBe('You are a helpful assistant.');
  expect(parsed.firstMessage).toBe('Hello, how can I help you today?');
  expect(parsed).not.toHaveProperty('firstMessageMode');
});

test('a sparse update does not inject create defaults', () => {
  const parsed = UpdateAssistantInputSchema.parse({ assistantId: '00000000-0000-4000-8000-000000000001', name: 'Renamed' });
  expect(parsed).toEqual({ assistantId: '00000000-0000-4000-8000-000000000001', name: 'Renamed' });
  expect(transformUpdateAssistantInput(parsed)).toEqual({ name: 'Renamed' });
});

test.each([
  { provider: 'unknown', model: 'anything' },
  JSON.stringify({ provider: 'unknown', model: 'anything' }),
])('LLM inputs validate their provider after decoding JSON: %j', llm => {
  expect(CreateAssistantInputSchema.safeParse({ name: 'LLM check', llm }).success).toBe(false);
});

test.each([
  [{ provider: 'vapi', voiceId: 'Elliot' }, { provider: 'assembly-ai' }],
  [{ provider: '11labs', voiceId: 'sarah' }, { provider: 'deepgram' }],
])('assistant output does not invent absent provider models', (voice, transcriber) => {
  const output = transformAssistantOutput({
    id: '00000000-0000-4000-8000-000000000001', name: 'Schema contract', createdAt: '', updatedAt: '', voice, transcriber,
  } as Vapi.Assistant);
  expect(output.voice).toEqual(voice);
  expect(output.transcriber).toEqual(transcriber);
});
