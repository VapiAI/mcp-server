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
import { registerValidatedTool } from './validation.js';
import { creates, readOnly } from './annotations.js';
import { createToolHandler } from './utils.js';

const DEFAULT_LIMIT = 50;

// SDK 3.0 declares only the legacy array response, but pagination query
// parameters make this endpoint return an envelope instead.
type RunItemsResponse = Vapi.SimulationRunItem[] | {
  results: Vapi.SimulationRunItem[];
  metadata: Vapi.PaginationMeta;
};

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
  registerValidatedTool(
    server,
    'list_simulation_personalities',
    {
      description:
        'Lists simulation personalities: the simulated callers (testers) used in Vapi simulations',
      inputSchema: ListSimulationResourcesInputSchema,
      annotations: readOnly('List Simulation Personalities'),
    },
    createToolHandler(async (data) =>
      vapiClient.simulationPersonalities.personalityControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
      })
    )
  );

  registerValidatedTool(
    server,
    'create_simulation_personality',
    {
      description:
        'Creates a simulation personality: the simulated caller that talks to the assistant under test',
      inputSchema: CreateSimulationPersonalityInputSchema,
      annotations: creates('Create Simulation Personality'),
    },
    createToolHandler(async (data) =>
      vapiClient.simulationPersonalities.personalityControllerCreate(
        data as unknown as Vapi.CreatePersonalityDto
      )
    )
  );

  registerValidatedTool(
    server,
    'list_simulation_scenarios',
    {
      description:
        'Lists simulation scenarios: the scripts testers follow and the checks that decide pass or fail',
      inputSchema: ListSimulationScenariosInputSchema,
      annotations: readOnly('List Simulation Scenarios'),
    },
    createToolHandler(async (data) =>
      vapiClient.simulationScenarios.scenarioControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
        ...(data.name && { name: data.name }),
      })
    )
  );

  registerValidatedTool(
    server,
    'create_simulation_scenario',
    {
      description:
        'Creates a simulation scenario: instructions for the tester plus evaluations that decide whether the assistant passed',
      inputSchema: CreateSimulationScenarioInputSchema,
      annotations: creates('Create Simulation Scenario'),
    },
    createToolHandler(async ({ additionalFields, ...data }) =>
      vapiClient.simulationScenarios.scenarioControllerCreate({
        ...data,
        ...additionalFields,
      } as unknown as Vapi.CreateScenarioDto)
    )
  );

  registerValidatedTool(
    server,
    'list_simulations',
    {
      description:
        'Lists simulations. Each simulation pairs one scenario with one personality.',
      inputSchema: ListSimulationResourcesInputSchema,
      annotations: readOnly('List Simulations'),
    },
    createToolHandler(async (data) =>
      vapiClient.simulations.simulationControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
      })
    )
  );

  registerValidatedTool(
    server,
    'create_simulation',
    {
      description:
        'Creates a simulation that pairs a scenario with a personality. Run it with run_simulations.',
      inputSchema: CreateSimulationInputSchema,
      annotations: creates('Create Simulation'),
    },
    createToolHandler(async (data) =>
      vapiClient.simulations.simulationControllerCreate(data)
    )
  );

  registerValidatedTool(
    server,
    'list_simulation_suites',
    {
      description: 'Lists simulation suites: named groups of simulations',
      inputSchema: ListSimulationResourcesInputSchema,
      annotations: readOnly('List Simulation Suites'),
    },
    createToolHandler(async (data) =>
      vapiClient.simulationSuites.simulationSuiteControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
      })
    )
  );

  registerValidatedTool(
    server,
    'create_simulation_suite',
    {
      description:
        'Creates a simulation suite that groups simulations so they can be run together',
      inputSchema: CreateSimulationSuiteInputSchema,
      annotations: creates('Create Simulation Suite'),
    },
    createToolHandler(async ({ additionalFields, ...data }) =>
      vapiClient.simulationSuites.simulationSuiteControllerCreate({
        ...data,
        ...additionalFields,
      } as unknown as Vapi.CreateSimulationSuiteDto)
    )
  );

  registerValidatedTool(
    server,
    'run_simulations',
    {
      description:
        'Starts a simulation run of simulations and/or suites against an assistant or squad. ' +
        'Returns the run with its ID and a dashboard URL to share with the user. Check progress with get_simulation_run.',
      inputSchema: RunSimulationsInputSchema,
      annotations: creates('Run Simulations'),
    },
    createToolHandler(async (data) => {
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

  registerValidatedTool(
    server,
    'list_simulation_runs',
    {
      description: 'Lists simulation runs, newest first',
      inputSchema: ListSimulationRunsInputSchema,
      annotations: readOnly('List Simulation Runs'),
    },
    createToolHandler(async (data) =>
      vapiClient.simulationRuns.simulationRunControllerFindAll({
        limit: data.limit ?? DEFAULT_LIMIT,
        ...(data.status && { status: data.status }),
        ...(data.targetId && { targetId: data.targetId }),
      })
    )
  );

  registerValidatedTool(
    server,
    'get_simulation_run',
    {
      description:
        'Gets a simulation run with its status, item counts, and the first 100 item summaries. ' +
        'itemsTruncated indicates omitted items; itemsMetadata preserves API pagination metadata. ' +
        'Use get_simulation_run_item for an item’s transcript and call details.',
      inputSchema: GetSimulationRunInputSchema,
      annotations: readOnly('Get Simulation Run'),
    },
    createToolHandler(async (data) => {
      const [run, response] = await Promise.all([
        vapiClient.simulationRuns.simulationRunControllerFindOne({
          id: data.runId,
        }),
        vapiClient.simulationRuns.simulationRunControllerFindItems({
          id: data.runId,
          limit: 100,
        }),
      ]);
      const page = response as RunItemsResponse;
      const items = Array.isArray(page) ? page : page.results;
      return {
        ...run,
        items: items.map(summarizeRunItem),
        itemsTruncated: !Array.isArray(page) && page.metadata.totalItems > items.length,
        ...(!Array.isArray(page) && { itemsMetadata: page.metadata }),
      };
    })
  );

  registerValidatedTool(
    server,
    'get_simulation_run_item',
    {
      description:
        'Gets one simulation run item in full, including results, call snapshots, transcript, and improvement suggestions',
      inputSchema: GetSimulationRunItemInputSchema,
      annotations: readOnly('Get Simulation Run Item'),
    },
    createToolHandler(async (data) =>
      vapiClient.simulationRuns.simulationRunControllerFindItem({
        id: data.runId,
        itemId: data.itemId,
      })
    )
  );
};
