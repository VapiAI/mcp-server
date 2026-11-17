import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { FixtureState } from './types.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-11-15T12:00:00.000Z';

function freshState(seed?: string): FixtureState {
  const state: FixtureState = {
    assistants: [], calls: [], phoneNumbers: [], tools: [], simulationPersonalities: [],
    simulationScenarios: [], simulations: [], simulationSuites: [], simulationRuns: [], actions: [],
  };
  if (seed === 'existing-assistant' || seed === 'existing-tool' || seed === 'simulation-ready' || seed === 'call-history') {
    state.assistants.push({
      id: id(1), createdAt: now, updatedAt: now, name: 'Test Seed Assistant',
      model: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2, toolIds: seed === 'existing-tool' ? [id(4)] : [] , messages: [{ role: 'system', content: 'Help callers book an appointment.' }] },
      voice: { provider: '11labs', voiceId: 'sarah', model: 'eleven_turbo_v2_5' },
      transcriber: { provider: 'deepgram', model: 'nova-3' },
      firstMessage: 'Thanks for calling. How can I help?',
    });
    state.phoneNumbers.push({ id: id(3), createdAt: now, updatedAt: now, name: 'Harbor test number', number: '+15555550101', status: 'active' });
  }
  if (seed === 'existing-tool' || seed === 'simulation-ready') {
    state.tools.push({
      id: id(4), createdAt: now, updatedAt: now, type: 'function',
      function: { name: 'appointment_lookup', description: 'Looks up appointment availability', parameters: { type: 'object', properties: {} } },
      server: { url: 'https://appointments.example.test/slots', headers: {} },
    });
  }
  if (seed === 'simulation-ready') {
    state.simulationPersonalities.push({ id: id(7), name: 'Rescheduling Caller' });
    state.simulationScenarios.push({ id: id(8), name: 'Appointment rescheduling' });
    state.simulations.push({ id: id(9), name: 'Rescheduling test', assistantId: id(1), personalityId: id(7), scenarioId: id(8) });
    state.simulationSuites.push({ id: id(10), name: 'Harbor Regression Suite', simulationIds: [id(9)] });
  }
  if (seed === 'call-history') {
    state.calls.push({ id: id(2), createdAt: now, updatedAt: now, status: 'ended', assistantId: id(1), phoneNumberId: id(3), customer: { number: '+15555550199' }, transcript: 'fixture-only transcript that get_call does not expose', recordingUrl: 'https://fixture.example.test/recording' });
  }
  return state;
}

const routeNames: Record<string, keyof Omit<FixtureState, 'actions'>> = {
  assistant: 'assistants', call: 'calls', 'phone-number': 'phoneNumbers', tool: 'tools',
  'simulation-personality': 'simulationPersonalities', 'simulation-scenario': 'simulationScenarios',
  simulation: 'simulations', 'simulation-suite': 'simulationSuites', 'simulation-run': 'simulationRuns',
};

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function merge(target: Record<string, unknown>, update: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(update)) {
    const current = result[key];
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)
      ? merge(current as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  result.updatedAt = now;
  return result;
}

export interface FixtureApi {
  url: string;
  snapshot(): FixtureState;
  close(): Promise<void>;
}

function createRuntime(seed?: string) {
  const state = freshState(seed);
  let nextId = 5;
  const handle = (method: string, inputUrl: string, body?: Record<string, unknown>) => {
    const url = new URL(inputUrl, 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/__fixture/state' && method === 'GET') return { status: 200, value: state };
    if (path === '/api-json' && method === 'GET') return { status: 200, value: { openapi: '3.0.0', paths: {}, components: { schemas: {} } } };

    const rawSegments = path.split('/').filter(Boolean);
    let segments = rawSegments;
    if (rawSegments[0] === 'eval' && rawSegments[1] === 'simulation') {
      const kind = rawSegments[2];
      const names: Record<string, string> = { personality: 'simulation-personality', scenario: 'simulation-scenario', suite: 'simulation-suite', run: 'simulation-run' };
      segments = kind && names[kind] ? [names[kind]!, ...rawSegments.slice(3)] : ['simulation', ...rawSegments.slice(2)];
    }
    const collection = routeNames[segments[0] ?? ''];
    if (!collection) return { status: 404, value: { message: `No fixture route for ${method} ${path}` } };
    const rows = state[collection] as Record<string, unknown>[];
    state.actions.push({ method, path, ...(body ? { body } : {}) });

    if (collection === 'simulationRuns' && method === 'GET' && segments[2] === 'item') {
      const run = rows.find(row => row.id === segments[1]);
      const items = (run?.items ?? []) as Record<string, unknown>[];
      return { status: 200, value: segments[3] ? items.find(item => item.id === segments[3]) ?? {} : items };
    }
    if (method === 'GET' && segments.length === 1) return { status: 200, value: rows };
    if (method === 'GET' && segments.length > 1) {
      const found = rows.find(row => row.id === segments[1]);
      return found ? { status: 200, value: found } : { status: 404, value: { message: 'Fixture resource not found' } };
    }
    if (method === 'POST') {
      const created: Record<string, unknown> = { ...body, id: body?.id ?? id(nextId++), createdAt: now, updatedAt: now };
      if (collection === 'calls') {
        created.status = 'queued';
      }
      if (collection === 'simulationRuns') {
        created.status = 'completed';
        const selection = Array.isArray(body?.simulations) ? body.simulations[0] as Record<string, unknown> : undefined;
        const suite = state.simulationSuites.find(row => row.id === selection?.simulationSuiteId);
        const simulationId = selection?.simulationId ?? (Array.isArray(suite?.simulationIds) ? suite.simulationIds[0] : undefined);
        created.items = [{ id: id(nextId++), orgId: id(99), runId: created.id, simulationId, status: 'failed', queuedAt: now, createdAt: now, updatedAt: now, results: { evaluations: [], passed: false } }];
      }
      rows.push(created);
      return { status: 201, value: created };
    }
    if ((method === 'PATCH' || method === 'PUT') && segments.length > 1) {
      const index = rows.findIndex(row => row.id === segments[1]);
      if (index < 0) return { status: 404, value: { message: 'Fixture resource not found' } };
      rows[index] = merge(rows[index]!, body ?? {});
      return { status: 200, value: rows[index] };
    }
    return { status: 405, value: { message: `Unsupported fixture operation ${method} ${path}` } };
  };
  return { state, handle, snapshot: () => structuredClone(state) };
}

export function createFixtureFetch(seed?: string) {
  const runtime = createRuntime(seed);
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = ['POST', 'PATCH', 'PUT'].includes(request.method) ? await request.json() as Record<string, unknown> : undefined;
    const result = runtime.handle(request.method, request.url, body);
    return new Response(JSON.stringify(result.value), { status: result.status, headers: { 'content-type': 'application/json' } });
  };
  return { url: 'http://vapi-fixture.local', fetch: fetcher, snapshot: runtime.snapshot };
}

export async function startFixtureApi(seed?: string): Promise<FixtureApi> {
  const runtime = createRuntime(seed);
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const method = request.method ?? 'GET';
    const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(request) : undefined;
    const result = runtime.handle(method, url.toString(), body);
    send(response, result.status, result.value);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture API did not bind to a local TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    snapshot: runtime.snapshot,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
