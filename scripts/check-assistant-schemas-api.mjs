import { VoiceInputSchema, TranscriberInputSchema } from '../dist/schemas/assistant-openapi.js';
import { probeAssistantApi } from './lib/probe-assistant-api.mjs';

if (!process.env.VAPI_TOKEN) throw new Error('Set VAPI_TOKEN to a test-organization token');
const cases = [
  { name: 'vapi without model', field: 'voice', input: { provider: 'vapi', voiceId: 'Elliot' }, accepted: true },
  { name: 'vapi with foreign model', field: 'voice', input: { provider: 'vapi', voiceId: 'Elliot', model: 'eleven_turbo_v2_5' }, accepted: false },
  { name: '11labs preset voice', field: 'voice', input: { provider: '11labs', voiceId: 'sarah' }, accepted: true },
  { name: 'assembly-ai without model', field: 'transcriber', input: { provider: 'assembly-ai' }, accepted: true },
  { name: 'assembly-ai with foreign model', field: 'transcriber', input: { provider: 'assembly-ai', model: 'nova-3' }, accepted: false },
  { name: 'deepgram without model', field: 'transcriber', input: { provider: 'deepgram' }, accepted: true },
  { name: 'deepgram named model', field: 'transcriber', input: { provider: 'deepgram', model: 'nova-3' }, accepted: true },
];
const validators = { voice: VoiceInputSchema, transcriber: TranscriberInputSchema };
const rows = [];
for (const testCase of cases) {
  const local = validators[testCase.field].safeParse(testCase.input).success;
  const actual = await probeAssistantApi(testCase, process.env.VAPI_TOKEN);
  rows.push({ case: testCase.name, local, api: actual.apiAccepts, expected: testCase.accepted, status: actual.status });
}
console.table(rows);
if (rows.some(row => row.local !== row.api || row.api !== row.expected)) {
  console.error('Provider validation disagrees with the API or the expected contract.');
  process.exitCode = 1;
}
