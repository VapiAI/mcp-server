import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';
import { parseToolResponse } from '../utils/response.js';

const run = {
  id: 'run-1',
  status: 'ended',
  url: 'https://dashboard.vapi.ai/simulations/runs/run-1',
};

const runItem = {
  id: 'item-1',
  simulationId: 'sim-1',
  status: 'failed',
  failureReason: 'evaluation failed',
  results: { evaluations: [{ passed: false }] },
  metadata: { transcript: 'long transcript' },
  configurations: { transport: 'vapi.websocket' },
  improvementSuggestions: { prompt: 'Be clearer' },
};

const vapiOperations = {
  simulationPersonalities: {
    personalityControllerFindAll: jest.fn(async () => [{ id: 'per-1' }]),
    personalityControllerCreate: jest.fn(async () => ({ id: 'per-1' })),
  },
  simulationScenarios: {
    scenarioControllerFindAll: jest.fn(async () => [{ id: 'scn-1' }]),
    scenarioControllerCreate: jest.fn(async () => ({ id: 'scn-1' })),
  },
  simulations: {
    simulationControllerFindAll: jest.fn(async () => [{ id: 'sim-1' }]),
    simulationControllerCreate: jest.fn(async () => ({ id: 'sim-1' })),
  },
  simulationSuites: {
    simulationSuiteControllerFindAll: jest.fn(async () => [{ id: 'suite-1' }]),
    simulationSuiteControllerCreate: jest.fn(async () => ({ id: 'suite-1' })),
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
      { status: 'ended', targetId: 'asst-1' },
      vapiOperations.simulationRuns.simulationRunControllerFindAll,
      { limit: 50, status: 'ended', targetId: 'asst-1' },
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
          structuredOutputId: 'so-1',
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
          structuredOutputId: 'so-1',
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
      scenarioId: 'scn-1',
      personalityId: 'per-1',
    });
    expect(
      vapiOperations.simulations.simulationControllerCreate
    ).toHaveBeenLastCalledWith({ scenarioId: 'scn-1', personalityId: 'per-1' });

    await invoke('create_simulation_suite', {
      name: 'Refunds',
      simulationIds: ['sim-1'],
    });
    expect(
      vapiOperations.simulationSuites.simulationSuiteControllerCreate
    ).toHaveBeenLastCalledWith({ name: 'Refunds', simulationIds: ['sim-1'] });
  });

  test('run_simulations builds the run and sends the idempotency key', async () => {
    const result = await invoke('run_simulations', {
      assistantId: 'asst-1',
      simulationIds: ['sim-1'],
      suiteIds: ['suite-1'],
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
          { type: 'simulation', simulationId: 'sim-1' },
          { type: 'simulationSuite', simulationSuiteId: 'suite-1' },
        ],
        target: { type: 'assistant', assistantId: 'asst-1' },
        iterations: 2,
        transport: { provider: 'vapi.webchat' },
      },
      { headers: { 'Idempotency-Key': 'retry-safe-1' } }
    );
  });

  test('run_simulations targets a squad without an idempotency key', async () => {
    await invoke('run_simulations', {
      squadId: 'squad-1',
      suiteIds: ['suite-1'],
    });

    expect(
      vapiOperations.simulationRuns.simulationRunControllerCreate
    ).toHaveBeenLastCalledWith(
      {
        simulations: [{ type: 'simulationSuite', simulationSuiteId: 'suite-1' }],
        target: { type: 'squad', squadId: 'squad-1' },
      },
      undefined
    );
  });

  test.each([
    [{ simulationIds: ['sim-1'] }, 'Give exactly one of assistantId or squadId.'],
    [
      { assistantId: 'asst-1', squadId: 'squad-1', simulationIds: ['sim-1'] },
      'Give exactly one of assistantId or squadId.',
    ],
    [{ assistantId: 'asst-1' }, 'Give at least one simulationId or suiteId.'],
  ])('run_simulations rejects %j', async (args, message) => {
    const callsBefore =
      vapiOperations.simulationRuns.simulationRunControllerCreate.mock.calls
        .length;

    const response = await client.callTool({
      name: 'run_simulations',
      arguments: args,
    });

    expect(parseToolResponse(response)).toEqual({ error: `Error: ${message}` });
    expect(
      vapiOperations.simulationRuns.simulationRunControllerCreate
    ).toHaveBeenCalledTimes(callsBefore);
  });

  test('get_simulation_run returns the run with item summaries', async () => {
    const result = await invoke('get_simulation_run', { runId: 'run-1' });

    expect(
      vapiOperations.simulationRuns.simulationRunControllerFindItems
    ).toHaveBeenLastCalledWith({ id: 'run-1', limit: 100 });
    expect(result).toEqual({
      ...run,
      items: [
        {
          id: 'item-1',
          simulationId: 'sim-1',
          status: 'failed',
          failureReason: 'evaluation failed',
          results: { evaluations: [{ passed: false }] },
        },
      ],
    });
  });

  test('get_simulation_run_item returns the full item', async () => {
    const result = await invoke('get_simulation_run_item', {
      runId: 'run-1',
      itemId: 'item-1',
    });

    expect(
      vapiOperations.simulationRuns.simulationRunControllerFindItem
    ).toHaveBeenLastCalledWith({ id: 'run-1', itemId: 'item-1' });
    expect(result).toEqual(runItem);
  });
});
