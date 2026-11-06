import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';
import { parseToolResponse } from '../utils/response.js';

const run = {
  id: '00000000-0000-4000-8000-000000000008',
  status: 'ended',
  url: 'https://dashboard.vapi.ai/simulations/runs/run-1',
};

const runItem = {
  id: '00000000-0000-4000-8000-000000000009',
  simulationId: '00000000-0000-4000-8000-000000000003',
  status: 'failed',
  failureReason: 'evaluation failed',
  results: { evaluations: [{ passed: false }] },
  metadata: { transcript: 'long transcript' },
  configurations: { transport: 'vapi.websocket' },
  improvementSuggestions: { prompt: 'Be clearer' },
};

const vapiOperations = {
  simulationPersonalities: {
    personalityControllerFindAll: jest.fn(async () => [{ id: '00000000-0000-4000-8000-000000000006' }]),
    personalityControllerCreate: jest.fn(async () => ({ id: '00000000-0000-4000-8000-000000000006' })),
  },
  simulationScenarios: {
    scenarioControllerFindAll: jest.fn(async () => [{ id: '00000000-0000-4000-8000-000000000005' }]),
    scenarioControllerCreate: jest.fn(async () => ({ id: '00000000-0000-4000-8000-000000000005' })),
  },
  simulations: {
    simulationControllerFindAll: jest.fn(async () => [{ id: '00000000-0000-4000-8000-000000000003' }]),
    simulationControllerCreate: jest.fn(async () => ({ id: '00000000-0000-4000-8000-000000000003' })),
  },
  simulationSuites: {
    simulationSuiteControllerFindAll: jest.fn(async () => [{ id: '00000000-0000-4000-8000-000000000004' }]),
    simulationSuiteControllerCreate: jest.fn(async () => ({ id: '00000000-0000-4000-8000-000000000004' })),
  },
  simulationRuns: {
    simulationRunControllerCreate: jest.fn(async () => run),
    simulationRunControllerFindAll: jest.fn(async () => [run]),
    simulationRunControllerFindOne: jest.fn(async () => run),
    simulationRunControllerFindItems: jest.fn(async () => [runItem]),
    simulationRunControllerFindItem: jest.fn(async () => runItem),
  },
};

describe('simulation tools', () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    server = new McpServer({ name: 'simulation-test-server', version: '0.0.0' });
    registerAllTools(server, vapiOperations as unknown as VapiClient);
    client = new Client({ name: 'simulation-test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  async function invoke(name: string, args: Record<string, unknown>) {
    const response = await client.callTool({ name, arguments: args });
    const parsed = parseToolResponse(response);
    expect(response.isError).not.toBe(true);
    expect(parsed?.error).toBeUndefined();
    return parsed;
  }

  test.each([
    [
      'list_simulation_personalities',
      {},
      vapiOperations.simulationPersonalities.personalityControllerFindAll,
      { limit: 50 },
    ],
    [
      'list_simulation_scenarios',
      { name: 'Refund', limit: 5 },
      vapiOperations.simulationScenarios.scenarioControllerFindAll,
      { limit: 5, name: 'Refund' },
    ],
    [
      'list_simulations',
      {},
      vapiOperations.simulations.simulationControllerFindAll,
      { limit: 50 },
    ],
    [
      'list_simulation_suites',
      {},
      vapiOperations.simulationSuites.simulationSuiteControllerFindAll,
      { limit: 50 },
    ],
    [
      'list_simulation_runs',
      { status: 'ended', targetId: '00000000-0000-4000-8000-000000000001' },
      vapiOperations.simulationRuns.simulationRunControllerFindAll,
      { limit: 50, status: 'ended', targetId: '00000000-0000-4000-8000-000000000001' },
    ],
  ])('%s passes its filters to Vapi', async (name, args, operation, expected) => {
    await invoke(name, args);
    expect(operation).toHaveBeenLastCalledWith(expected);
  });

  test('create_simulation_personality sends the tester assistant', async () => {
    const assistant = {
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'system', content: 'You are an impatient caller.' }],
      },
    };
    await invoke('create_simulation_personality', {
      name: 'Impatient Ian',
      assistant,
    });

    expect(
      vapiOperations.simulationPersonalities.personalityControllerCreate
    ).toHaveBeenLastCalledWith({ name: 'Impatient Ian', assistant });
  });

  test('create_simulation_scenario sends evaluations and additional fields', async () => {
    await invoke('create_simulation_scenario', {
      name: 'Refund request',
      instructions: 'Ask for a refund on order 123.',
      evaluations: [
        {
          structuredOutputId: '00000000-0000-4000-8000-000000000007',
          comparator: '=',
          value: true,
          path: 'refundOffered',
        },
      ],
      additionalFields: { toolMocks: [{ toolName: 'lookup_order' }] },
    });

    expect(
      vapiOperations.simulationScenarios.scenarioControllerCreate
    ).toHaveBeenLastCalledWith({
      name: 'Refund request',
      instructions: 'Ask for a refund on order 123.',
      evaluations: [
        {
          structuredOutputId: '00000000-0000-4000-8000-000000000007',
          comparator: '=',
          value: true,
          path: 'refundOffered',
        },
      ],
      toolMocks: [{ toolName: 'lookup_order' }],
    });
  });

  test('create_simulation and create_simulation_suite send their IDs', async () => {
    await invoke('create_simulation', {
      scenarioId: '00000000-0000-4000-8000-000000000005',
      personalityId: '00000000-0000-4000-8000-000000000006',
    });
    expect(
      vapiOperations.simulations.simulationControllerCreate
    ).toHaveBeenLastCalledWith({ scenarioId: '00000000-0000-4000-8000-000000000005', personalityId: '00000000-0000-4000-8000-000000000006' });

    await invoke('create_simulation_suite', {
      name: 'Refunds',
      simulationIds: ['00000000-0000-4000-8000-000000000003'],
    });
    expect(
      vapiOperations.simulationSuites.simulationSuiteControllerCreate
    ).toHaveBeenLastCalledWith({ name: 'Refunds', simulationIds: ['00000000-0000-4000-8000-000000000003'] });
  });

  test('run_simulations builds the run and sends the idempotency key', async () => {
    const result = await invoke('run_simulations', {
      assistantId: '00000000-0000-4000-8000-000000000001',
      simulationIds: ['00000000-0000-4000-8000-000000000003'],
      suiteIds: ['00000000-0000-4000-8000-000000000004'],
      iterations: 2,
      transport: 'vapi.webchat',
      idempotencyKey: 'retry-safe-1',
    });

    expect(result.url).toBe(run.url);
    expect(
      vapiOperations.simulationRuns.simulationRunControllerCreate
    ).toHaveBeenLastCalledWith(
      {
        simulations: [
          { type: 'simulation', simulationId: '00000000-0000-4000-8000-000000000003' },
          { type: 'simulationSuite', simulationSuiteId: '00000000-0000-4000-8000-000000000004' },
        ],
        target: { type: 'assistant', assistantId: '00000000-0000-4000-8000-000000000001' },
        iterations: 2,
        transport: { provider: 'vapi.webchat' },
      },
      { headers: { 'Idempotency-Key': 'retry-safe-1' } }
    );
  });

  test('run_simulations targets a squad without an idempotency key', async () => {
    await invoke('run_simulations', {
      squadId: '00000000-0000-4000-8000-000000000002',
      suiteIds: ['00000000-0000-4000-8000-000000000004'],
    });

    expect(
      vapiOperations.simulationRuns.simulationRunControllerCreate
    ).toHaveBeenLastCalledWith(
      {
        simulations: [{ type: 'simulationSuite', simulationSuiteId: '00000000-0000-4000-8000-000000000004' }],
        target: { type: 'squad', squadId: '00000000-0000-4000-8000-000000000002' },
      },
      undefined
    );
  });

  test.each([
    [{ simulationIds: ['00000000-0000-4000-8000-000000000003'] }, 'Give exactly one of assistantId or squadId.'],
    [
      { assistantId: '00000000-0000-4000-8000-000000000001', squadId: '00000000-0000-4000-8000-000000000002', simulationIds: ['00000000-0000-4000-8000-000000000003'] },
      'Give exactly one of assistantId or squadId.',
    ],
    [{ assistantId: '00000000-0000-4000-8000-000000000001' }, 'Give at least one simulationId or suiteId.'],
  ])('run_simulations rejects %j', async (args, message) => {
    const callsBefore =
      vapiOperations.simulationRuns.simulationRunControllerCreate.mock.calls
        .length;

    const response = await client.callTool({
      name: 'run_simulations',
      arguments: args,
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
      code: 'INVALID_ARGUMENTS', issues: expect.arrayContaining([expect.objectContaining({ message })]),
    }) });
    expect(
      vapiOperations.simulationRuns.simulationRunControllerCreate
    ).toHaveBeenCalledTimes(callsBefore);
  });

  test('get_simulation_run returns the run with item summaries', async () => {
    const result = await invoke('get_simulation_run', { runId: '00000000-0000-4000-8000-000000000008' });

    expect(
      vapiOperations.simulationRuns.simulationRunControllerFindItems
    ).toHaveBeenLastCalledWith({ id: '00000000-0000-4000-8000-000000000008', limit: 100 });
    expect(result).toEqual({
      ...run,
      items: [
        {
          id: '00000000-0000-4000-8000-000000000009',
          simulationId: '00000000-0000-4000-8000-000000000003',
          status: 'failed',
          failureReason: 'evaluation failed',
          results: { evaluations: [{ passed: false }] },
        },
      ],
    });
  });

  test('get_simulation_run_item returns the full item', async () => {
    const result = await invoke('get_simulation_run_item', {
      runId: '00000000-0000-4000-8000-000000000008',
      itemId: '00000000-0000-4000-8000-000000000009',
    });

    expect(
      vapiOperations.simulationRuns.simulationRunControllerFindItem
    ).toHaveBeenLastCalledWith({ id: '00000000-0000-4000-8000-000000000008', itemId: '00000000-0000-4000-8000-000000000009' });
    expect(result).toEqual(runItem);
  });
});

// Validate through MCP, so these cases prove that a rejected input never
// reaches any SDK method, including values hidden in additionalFields.
describe('simulation OpenAPI validation feedback', () => {
  let server: McpServer;
  let client: Client;
  const id = '00000000-0000-4000-8000-000000000001';
  beforeAll(async () => {
    server = new McpServer({ name: 'simulation-validation', version: '0' });
    registerAllTools(server, vapiOperations as unknown as VapiClient);
    client = new Client({ name: 'simulation-validation-client', version: '0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st); await client.connect(ct);
  });
  afterAll(async () => { await client.close(); await server.close(); });
  const invocationCount = () => Object.values(vapiOperations).flatMap(Object.values)
    .reduce((total, operation) => total + operation.mock.calls.length, 0);

  test.each([
    ['create_simulation_personality', { name: 'x'.repeat(81), assistant: {} }, 'name'],
    ['create_simulation_personality', { name: 'Test', assistant: { maxDurationSeconds: 1 } }, 'assistant.maxDurationSeconds'],
    ['create_simulation_personality', { name: 'Test', assistant: { model: { provider: 'unknown' } } }, 'assistant.model.provider'],
    ['create_simulation_scenario', { name: 'Test', instructions: 'x'.repeat(10001), evaluations: [] }, 'instructions'],
    ['create_simulation_scenario', { name: 'Test', instructions: 'Help', evaluations: [{ comparator: '=', value: true, structuredOutputId: 'bad' }] }, 'evaluations[0].structuredOutputId'],
    ['create_simulation_scenario', { name: 'Test', instructions: 'Help', evaluations: [{ comparator: '=', value: true, structuredOutput: { name: 'Extract' } }] }, 'evaluations[0].structuredOutput.schema'],
    ['create_simulation_scenario', { name: 'Test', instructions: 'Help', evaluations: [], additionalFields: { instructions: 'x'.repeat(10001) } }, 'additionalFields.instructions'],
    ['create_simulation_scenario', { name: 'Test', instructions: 'Help', evaluations: [], additionalFields: { toolMocks: [{ toolName: 'test', enabled: 'yes' }] } }, 'additionalFields.toolMocks[0].enabled'],
    ['create_simulation_suite', { name: 'Test', simulationIds: [id], additionalFields: { simulationIds: [42] } }, 'additionalFields.simulationIds[0]'],
    ['create_simulation', { scenarioId: 'bad', personalityId: id }, 'scenarioId'],
    ['create_simulation', { scenarioId: id, personalityId: id, path: 'too/many/folder/levels' }, 'path'],
    ['run_simulations', { assistantId: id, simulationIds: [id], iterations: 11 }, 'iterations'],
    ['run_simulations', { assistantId: id, simulationIds: [id], iterations: 1.5 }, 'iterations'],
    ['run_simulations', { assistantId: id, suiteIds: ['bad'] }, 'suiteIds[0]'],
    ['run_simulations', { assistantId: id, simulationIds: [id], transport: 'http' }, 'transport'],
    ['list_simulations', { limit: 101 }, 'limit'],
    ['list_simulation_runs', { targetId: 'bad' }, 'targetId'],
    ['get_simulation_run', { runId: 'bad' }, 'runId'],
    ['get_simulation_run_item', { runId: id, itemId: 42 }, 'itemId'],
  ] as Array<[string, Record<string, unknown>, string]>)('%s rejects invalid API input', async (name, args, path) => {
    const before = invocationCount();
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
      code: 'INVALID_ARGUMENTS', tool: name,
      issues: expect.arrayContaining([expect.objectContaining({ path })]),
    }) });
    expect(invocationCount()).toBe(before);
  });

  test.each([
    ['create_simulation_personality', { name: 'Test', assistant: { maxDurationSeconds: 1 } }, 'assistant.maxDurationSeconds'],
    ['create_simulation_scenario', { name: 'Test', instructions: 'Help', evaluations: [
      { comparator: '=', value: true, structuredOutput: { name: 'Extract' } },
    ] }, 'evaluations[0].structuredOutput.schema'],
  ] as Array<[string, Record<string, unknown>, string]>)('%s keeps full validation behind compact discovery', async (name, args, path) => {
    const tool = (await client.listTools()).tools.find(tool => tool.name === name)!;
    const ajv = new Ajv({ strict: false });
    addFormats.default(ajv);
    const discovery = ajv.compile(tool.inputSchema);
    expect(discovery(args)).toBe(true);
    const before = invocationCount();
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toEqual({ validationError: expect.objectContaining({
      code: 'INVALID_ARGUMENTS', issues: expect.arrayContaining([expect.objectContaining({ path })]),
    }) });
    expect(invocationCount()).toBe(before);
  });

  test('an agent can correct the reported bound and retry without injected API defaults', async () => {
    const operation = vapiOperations.simulationRuns.simulationRunControllerCreate;
    const before = operation.mock.calls.length;
    const args = { assistantId: id, simulationIds: [id] };
    const invalid = await client.callTool({ name: 'run_simulations', arguments: { ...args, iterations: 11 } });
    expect(invalid.structuredContent).toEqual({ validationError: expect.objectContaining({
      issues: expect.arrayContaining([expect.objectContaining({ path: 'iterations', maximum: 10 })]),
    }) });
    expect(operation).toHaveBeenCalledTimes(before);
    const corrected = await client.callTool({ name: 'run_simulations', arguments: args });
    expect(corrected.isError).not.toBe(true);
    expect(operation).toHaveBeenCalledTimes(before + 1);
    expect(operation).toHaveBeenLastCalledWith({
      simulations: [{ type: 'simulation', simulationId: id }],
      target: { type: 'assistant', assistantId: id },
    }, undefined);
  });

  test('full nested configurations survive validation without adding defaults', async () => {
    const structuredOutput = { name: 'Eligible', schema: { type: 'boolean', default: false } };
    const evaluation = { structuredOutput, comparator: '=', value: true };
    const response = await client.callTool({ name: 'create_simulation_scenario', arguments: {
      name: 'Test', instructions: 'Ask for help', evaluations: [evaluation], path: null,
      additionalFields: { toolMocks: [{ toolName: 'lookup', result: 'ok' }] },
    } });
    expect(response.isError).not.toBe(true);
    expect(vapiOperations.simulationScenarios.scenarioControllerCreate).toHaveBeenLastCalledWith({
      name: 'Test', instructions: 'Ask for help', evaluations: [evaluation], path: null,
      toolMocks: [{ toolName: 'lookup', result: 'ok' }],
    });
  });

  test('large nested failures remain bounded and never echo submitted secrets', async () => {
    const secret = 'private-value-never-echo';
    const response = await client.callTool({ name: 'create_simulation_personality', arguments: {
      name: 'Test', assistant: { model: { provider: 'unknown', apiKey: secret } },
    } });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(JSON.stringify(response).length).toBeLessThan(4000);
  });
});
