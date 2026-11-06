import { describe, expect, test } from '@jest/globals';
import type { Vapi } from '@vapi-ai/server-sdk';
import { CreateAssistantInputSchema, UpdateAssistantInputSchema } from '../schemas/index.js';
import { transformAssistantOutput, transformAssistantInput, transformUpdateAssistantInput } from '../transformers/index.js';

describe.each([
  { schema: CreateAssistantInputSchema, base: { name: 'Cutover' }, operation: 'create' },
  { schema: UpdateAssistantInputSchema, base: { assistantId: 'assistant-1' }, operation: 'update' },
])('$operation assistant provider rules', ({ schema, base }) => {
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
    const create = transformAssistantInput(CreateAssistantInputSchema.parse({ name: 'Cutover', ...configuration }));
    const update = transformUpdateAssistantInput(UpdateAssistantInputSchema.parse({ assistantId: 'assistant-1', ...configuration }));
    expect(create.voice).toEqual(configuration.voice);
    expect(update.voice).toEqual(configuration.voice);
    expect(create.transcriber).toEqual({ provider });
    expect(update.transcriber).toEqual({ provider });
  });
});

test.each([
  [{ provider: 'vapi', voiceId: 'Elliot' }, { provider: 'assembly-ai' }],
  [{ provider: '11labs', voiceId: 'sarah' }, { provider: 'deepgram' }],
])('assistant output does not invent absent provider models', (voice, transcriber) => {
  const output = transformAssistantOutput({
    id: 'assistant-1', name: 'Cutover', createdAt: '', updatedAt: '', voice, transcriber,
  } as Vapi.Assistant);
  expect(output.voice).toEqual(voice);
  expect(output.transcriber).toEqual(transcriber);
});
