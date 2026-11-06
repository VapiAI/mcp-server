import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import {
  CreateSimulationInputSchema,
  CreateSimulationPersonalityInputSchema,
  CreateSimulationScenarioInputSchema,
  CreateSimulationSuiteInputSchema,
  GetSimulationRunInputSchema,
  GetSimulationRunItemInputSchema,
  ListSimulationResourcesInputSchema,
  ListSimulationRunsInputSchema,
  ListSimulationScenariosInputSchema,
  RunSimulationsInputSchema,
} from '../schemas/index.js';
import { createToolHandler } from './utils.js';

const DEFAULT_LIMIT = 50;

// Run items carry call snapshots and transcripts in these fields, which can
// be large. get_simulation_run leaves them out; get_simulation_run_item
// returns them.
const LARGE_RUN_ITEM_FIELDS = [
  'metadata',
  'configurations',
  'improvementSuggestions',
] as const;

function summarizeRunItem(item: Vapi.SimulationRunItem) {
  const summary: Record<string, unknown> = { ...item };
  for (const field of LARGE_RUN_ITEM_FIELDS) {
    delete summary[field];
  }
  return summary;
}

export const registerSimulationTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  server.registerTool(
    'list_simulation_personalities',
    {
      description:
        'Lists simulation personalities: the simulated callers (testers) used in Vapi simulations',
      inputSchema: ListSimulationResourcesInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.simulationPersonalities.personalityControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
      })
    )
  );

  server.registerTool(
    'create_simulation_personality',
    {
      description:
        'Creates a simulation personality: the simulated caller that talks to the assistant under test',
      inputSchema: CreateSimulationPersonalityInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.simulationPersonalities.personalityControllerCreate(
        data as unknown as Vapi.CreatePersonalityDto
      )
    )
  );

  server.registerTool(
    'list_simulation_scenarios',
    {
      description:
        'Lists simulation scenarios: the scripts testers follow and the checks that decide pass or fail',
      inputSchema: ListSimulationScenariosInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.simulationScenarios.scenarioControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
        ...(data.name && { name: data.name }),
      })
    )
  );

  server.registerTool(
    'create_simulation_scenario',
    {
      description:
        'Creates a simulation scenario: instructions for the tester plus evaluations that decide whether the assistant passed',
      inputSchema: CreateSimulationScenarioInputSchema.shape,
    },
    createToolHandler(async ({ additionalFields, ...data }) =>
      vapiClient.simulationScenarios.scenarioControllerCreate({
        ...data,
        ...additionalFields,
      } as unknown as Vapi.CreateScenarioDto)
    )
  );

  server.registerTool(
    'list_simulations',
    {
      description:
        'Lists simulations. Each simulation pairs one scenario with one personality.',
      inputSchema: ListSimulationResourcesInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.simulations.simulationControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
      })
    )
  );

  server.registerTool(
    'create_simulation',
    {
      description:
        'Creates a simulation that pairs a scenario with a personality. Run it with run_simulations.',
      inputSchema: CreateSimulationInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.simulations.simulationControllerCreate(data)
    )
  );

  server.registerTool(
    'list_simulation_suites',
    {
      description: 'Lists simulation suites: named groups of simulations',
      inputSchema: ListSimulationResourcesInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.simulationSuites.simulationSuiteControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
      })
    )
  );

  server.registerTool(
    'create_simulation_suite',
    {
      description:
        'Creates a simulation suite that groups simulations so they can be run together',
      inputSchema: CreateSimulationSuiteInputSchema.shape,
    },
    createToolHandler(async ({ additionalFields, ...data }) =>
      vapiClient.simulationSuites.simulationSuiteControllerCreate({
        ...data,
        ...additionalFields,
      } as unknown as Vapi.CreateSimulationSuiteDto)
    )
  );

  server.registerTool(
    'run_simulations',
    {
      description:
        'Starts a simulation run of simulations and/or suites against an assistant or squad. ' +
        'Returns the run with its ID and a dashboard URL to share with the user. Check progress with get_simulation_run.',
      inputSchema: RunSimulationsInputSchema.shape,
    },
    createToolHandler(async (data) => {
      if (!data.assistantId === !data.squadId) {
        throw new Error('Give exactly one of assistantId or squadId.');
      }
      const simulations = [
        ...(data.simulationIds ?? []).map((simulationId) => ({
          type: 'simulation' as const,
          simulationId,
        })),
        ...(data.suiteIds ?? []).map((simulationSuiteId) => ({
          type: 'simulationSuite' as const,
          simulationSuiteId,
        })),
      ];
      if (simulations.length === 0) {
        throw new Error('Give at least one simulationId or suiteId.');
      }

      return vapiClient.simulationRuns.simulationRunControllerCreate(
        {
          simulations,
          target: data.assistantId
            ? { type: 'assistant', assistantId: data.assistantId }
            : { type: 'squad', squadId: data.squadId },
          ...(data.iterations && { iterations: data.iterations }),
          ...(data.transport && { transport: { provider: data.transport } }),
        },
        data.idempotencyKey
          ? { headers: { 'Idempotency-Key': data.idempotencyKey } }
          : undefined
      );
    })
  );

  server.registerTool(
    'list_simulation_runs',
    {
      description: 'Lists simulation runs, newest first',
      inputSchema: ListSimulationRunsInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.simulationRuns.simulationRunControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
        ...(data.status && { status: data.status }),
        ...(data.targetId && { targetId: data.targetId }),
      })
    )
  );

  server.registerTool(
    'get_simulation_run',
    {
      description:
        'Gets a simulation run with its status, item counts, and each item’s status and evaluation results. ' +
        'Use get_simulation_run_item for an item’s transcript and call details.',
      inputSchema: GetSimulationRunInputSchema.shape,
    },
    createToolHandler(async (data) => {
      const [run, items] = await Promise.all([
        vapiClient.simulationRuns.simulationRunControllerFindOne({
          id: data.runId,
        }),
        vapiClient.simulationRuns.simulationRunControllerFindItems({
          id: data.runId,
          limit: 100,
        }),
      ]);
      return { ...run, items: items.map(summarizeRunItem) };
    })
  );

  server.registerTool(
    'get_simulation_run_item',
    {
      description:
        'Gets one simulation run item in full, including results, call snapshots, transcript, and improvement suggestions',
      inputSchema: GetSimulationRunItemInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.simulationRuns.simulationRunControllerFindItem({
        id: data.runId,
        itemId: data.itemId,
      })
    )
  );
};
