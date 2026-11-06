import { describe, expect, test } from '@jest/globals';
import { CreateAssistantInputSchema, UpdateAssistantInputSchema } from '../schemas/index.js';
import { transformAssistantInput, transformUpdateAssistantInput } from '../transformers/index.js';

// Contract examples shared by the handwritten and spec-derived implementations.
// New acceptance rules and stricter rejection cases belong to the cutover PR.
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
  { operation: 'update', schema: UpdateAssistantInputSchema, base: { assistantId: 'assistant-1' } },
])('$operation assistant schema contract', ({ operation, schema, base }) => {
  test.each(configurations)('preserves valid provider configuration: %j', configuration => {
    const parsed = schema.parse({ ...base, ...configuration });
    expect(parsed.voice).toEqual(configuration.voice);
    expect(parsed.transcriber).toEqual(configuration.transcriber);
    const dto = operation === 'create'
      ? transformAssistantInput(CreateAssistantInputSchema.parse({ name: 'Schema contract', ...configuration }))
      : transformUpdateAssistantInput(UpdateAssistantInputSchema.parse({ assistantId: 'assistant-1', ...configuration }));
    expect(dto.voice).toEqual(configuration.voice);
    expect(dto.transcriber).toEqual(configuration.transcriber);
  });

  test('accepts a name at the API boundary of 40 characters', () => {
    expect(schema.parse({ ...base, name: 'a'.repeat(40) }).name).toBe('a'.repeat(40));
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
  const parsed = UpdateAssistantInputSchema.parse({ assistantId: 'assistant-1', name: 'Renamed' });
  expect(parsed).toEqual({ assistantId: 'assistant-1', name: 'Renamed' });
  expect(transformUpdateAssistantInput(parsed)).toEqual({ name: 'Renamed' });
});
