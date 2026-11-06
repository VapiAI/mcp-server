import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeAssistantApi } from '../lib/probe-assistant-api.mjs';

const testCase = { name: 'test case', field: 'voice', input: { provider: 'vapi', voiceId: 'Elliot' } };

test('API backstop cleans up accepted records even when the spec rejects them', async () => {
  const methods = [];
  const result = await probeAssistantApi(testCase, 'test-token', async (url, options) => {
    methods.push(options.method);
    if (options.method === 'POST') return Response.json({ id: 'created-assistant' }, { status: 201 });
    assert.equal(url, 'https://api.vapi.ai/assistant/created-assistant');
    return new Response(null, { status: 204 });
  });
  assert.equal(result.apiAccepts, true);
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('API backstop treats validation rejection as data, not an infrastructure failure', async () => {
  const result = await probeAssistantApi(testCase, 'test-token', async (_url, options) => {
    assert.equal(options.method, 'POST');
    return Response.json({}, { status: 400 });
  });
  assert.equal(result.apiAccepts, false);
  await assert.rejects(probeAssistantApi(testCase, 'test-token', async () => new Response(null, { status: 401 })), /API probe failed/);
});

test('lost create responses recover by exact unique name and never delete unrelated assistants', async () => {
  let createdName;
  const deleted = [];
  await assert.rejects(probeAssistantApi(testCase, 'test-token', async (url, options) => {
    if (options.method === 'POST') {
      createdName = JSON.parse(options.body).name;
      throw new Error('simulated timeout containing test-token');
    }
    if (options.method === 'GET') return Response.json([
      { id: 'ours', name: createdName }, { id: 'unrelated', name: 'some other assistant' },
    ]);
    deleted.push(url);
    return new Response(null, { status: 204 });
  }), error => /API probe failed/.test(error.message) && !error.message.includes('test-token'));
  assert.deepEqual(deleted, ['https://api.vapi.ai/assistant/ours']);
});

test('cleanup failures surface a recovery marker', async () => {
  await assert.rejects(probeAssistantApi(testCase, 'test-token', async (_url, options) => options.method === 'POST'
    ? Response.json({ id: 'created-assistant' }, { status: 201 })
    : new Response(null, { status: 503 })), /cleanup incomplete; recover only assistant named schema-parity-/);
});
