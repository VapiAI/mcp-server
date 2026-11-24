export async function readSseResponse(response, id) {
  if (!response.body) throw new Error('Hosted MCP returned an empty event stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let dataLines = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) {
            const data = dataLines.join('\n');
            if (data !== '[DONE]') {
              const message = JSON.parse(data);
              if (message.id === id && !message.method) return message;
            }
            dataLines = [];
          }
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (done) break;
    }
    if (pending.startsWith('data:')) {
      dataLines.push(pending.slice(5).trimStart());
    }
    if (dataLines.length > 0 && dataLines.join('\n') !== '[DONE]') {
      const message = JSON.parse(dataLines.join('\n'));
      if (message.id === id && !message.method) return message;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  throw new Error('Hosted MCP returned no JSON-RPC result in its event stream');
}
