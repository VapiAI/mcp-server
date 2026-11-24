import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSseResponse } from './runtime-sse.mjs';

test('waits for the matching response after a notification and another response', async () => {
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":9,"result":{}}\n\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'));
    controller.close();
  } });
  assert.deepEqual(await readSseResponse(new Response(stream), 1), { jsonrpc: '2.0', id: 1, result: { ok: true } });
});
