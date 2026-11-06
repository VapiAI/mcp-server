import { randomUUID } from 'node:crypto';

// Creates configuration records only; it never initiates a call. Only IDs
// returned by this create, or recovered by its unique exact name, are deleted.
export async function probeAssistantApi(testCase, token, fetchImpl = fetch) {
  if (!token) throw new Error('VAPI_TOKEN for a test organization is required');
  const name = `schema-parity-${randomUUID().slice(0, 18)}`;
  const since = new Date(Date.now() - 60_000).toISOString();
  const request = (path, method, body) => fetchImpl(`https://api.vapi.ai${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  let id;
  let rejected = false;
  let result;
  let failure;
  let status;
  try {
    const response = await request('/assistant', 'POST', { name, [testCase.field]: testCase.input });
    status = response.status;
    rejected = response.status >= 400 && response.status < 500;
    if (!response.ok && ![400, 422].includes(response.status)) {
      throw new Error(`API probe ${testCase.name}: HTTP ${response.status} is not a validation result`);
    }
    if (response.ok) {
      const created = await response.json();
      if (typeof created.id !== 'string') throw new Error('Create response has no assistant ID');
      id = created.id;
    }
    result = { name: testCase.name, status: response.status, apiAccepts: response.ok };
  } catch {
    // Never include response bodies or upstream error messages in diagnostics.
    failure = new Error(`API probe failed for ${testCase.name}${status ? ` (HTTP ${status})` : ''}; recovery name: ${name}`);
  }
  try {
    const ids = new Set(id ? [id] : []);
    if (!id && !rejected) {
      // A timeout/invalid JSON can happen after the create committed remotely.
      const response = await request(`/assistant?limit=100&createdAtGe=${encodeURIComponent(since)}`, 'GET');
      if (!response.ok) throw new Error('Recovery lookup failed');
      const assistants = await response.json();
      if (!Array.isArray(assistants)) throw new Error('Unexpected recovery response');
      for (const assistant of assistants) {
        if (assistant.name === name && typeof assistant.id === 'string') ids.add(assistant.id);
      }
    }
    for (const assistantId of ids) {
      const response = await request(`/assistant/${encodeURIComponent(assistantId)}`, 'DELETE');
      if (!response.ok && response.status !== 404) throw new Error('Cleanup failed');
    }
  } catch {
    throw new Error(`API probe cleanup incomplete; recover only assistant named ${name}`);
  }
  if (failure) throw failure;
  return result;
}
