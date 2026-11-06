import { z } from 'zod';

// Simulations test an assistant or squad by having a tester (a personality)
// follow a scenario against it. A simulation pairs one scenario with one
// personality, a suite groups simulations, and a run executes simulations or
// suites against a target.

const limit = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Maximum number of results to return (default 50)');

const path = z
  .string()
  .optional()
  .describe('Optional folder path for organizing, up to 3 levels (e.g. "team/feature/variant")');

const additionalFields = (dtoName: string) =>
  z
    .record(z.any())
    .optional()
    .describe(
      `Other fields from the Vapi API, sent as given. Look them up with get_api_schema (${dtoName}).`
    );

export const ListSimulationResourcesInputSchema = z.object({ limit });

export const ListSimulationScenariosInputSchema = z.object({
  limit,
  name: z.string().optional().describe('Only scenarios with this name'),
});

export const CreateSimulationPersonalityInputSchema = z.object({
  name: z
    .string()
    .describe('Name of the personality (e.g. "Confused Carl", "Rude Rob")'),
  assistant: z
    .record(z.any())
    .describe(
      "The tester's full assistant configuration: its voice, model, and behavior, such as model.messages with the persona prompt. " +
        'Same shape as create_assistant in the Vapi API (get_api_schema: CreateAssistantDTO).'
    ),
  path,
});

const EvaluationSchema = z
  .object({
    structuredOutputId: z
      .string()
      .optional()
      .describe('ID of an existing structured output to evaluate. Use this or structuredOutput.'),
    structuredOutput: z
      .record(z.any())
      .optional()
      .describe('Inline structured output definition (get_api_schema: CreateStructuredOutputDTO)'),
    comparator: z
      .enum(['=', '!=', '>', '<', '>=', '<='])
      .describe('How to compare the extracted value with value'),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .describe('Expected value'),
    required: z
      .boolean()
      .optional()
      .describe('Whether this evaluation must pass for the simulation to pass (default true)'),
  })
  .passthrough();

export const CreateSimulationScenarioInputSchema = z.object({
  name: z.string().describe('Name of the scenario'),
  instructions: z
    .string()
    .describe('Script or instructions the tester follows during the simulation'),
  evaluations: z
    .array(EvaluationSchema)
    .describe('Structured-output checks that decide whether the simulation passed (get_api_schema: EvaluationPlanItem)'),
  path,
  additionalFields: additionalFields('CreateScenarioDTO'),
});

export const CreateSimulationInputSchema = z.object({
  scenarioId: z.string().describe('ID of the scenario to use'),
  personalityId: z.string().describe('ID of the personality to use'),
  name: z.string().optional().describe('Optional name for the simulation'),
  path,
});

export const CreateSimulationSuiteInputSchema = z.object({
  name: z.string().describe('Name of the suite'),
  simulationIds: z
    .array(z.string())
    .describe('IDs of the simulations to include'),
  path,
  additionalFields: additionalFields('CreateSimulationSuiteDTO'),
});

export const RunSimulationsInputSchema = z.object({
  assistantId: z
    .string()
    .optional()
    .describe('ID of the assistant to test. Give assistantId or squadId.'),
  squadId: z
    .string()
    .optional()
    .describe('ID of the squad to test. Give assistantId or squadId.'),
  simulationIds: z
    .array(z.string())
    .optional()
    .describe('IDs of simulations to run'),
  suiteIds: z
    .array(z.string())
    .optional()
    .describe('IDs of simulation suites to run'),
  iterations: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('How many times to run each simulation (default 1)'),
  transport: z
    .enum(['vapi.websocket', 'vapi.webchat'])
    .optional()
    .describe('vapi.websocket for a voice simulation, vapi.webchat for a chat simulation'),
  idempotencyKey: z
    .string()
    .optional()
    .describe(
      'Optional key that makes retries safe: a repeat request with the same key and body returns the original run instead of starting another'
    ),
});

export const ListSimulationRunsInputSchema = z.object({
  limit,
  status: z
    .enum(['queued', 'running', 'ended'])
    .optional()
    .describe('Only runs with this status'),
  targetId: z
    .string()
    .optional()
    .describe('Only runs against this assistant or squad ID'),
});

export const GetSimulationRunInputSchema = z.object({
  runId: z.string().describe('ID of the simulation run'),
});

export const GetSimulationRunItemInputSchema = z.object({
  runId: z.string().describe('ID of the simulation run'),
  itemId: z.string().describe('ID of the run item (from get_simulation_run)'),
});
