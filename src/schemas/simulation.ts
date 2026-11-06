import { z } from 'zod';
import { simulationField as field, simulationParameter as parameter, validateSimulationBody } from './simulation-openapi.js';

// Limits of 1–100 integers and a default of 50 are the compact MCP paging
// policy; the API's imported range is 0–1000. Keep that policy explicit.
const limit = parameter<number>('limit').pipe(z.number().int().min(1).max(100)).optional()
  .describe('Maximum number of results to return (default 50)');
const additionalFields = z.record(z.string(), z.unknown()).optional()
  .describe('Additional documented API fields. The merged request is validated against the bundled Vapi OpenAPI schema.');

export const ListSimulationResourcesInputSchema = z.object({ limit });
export const ListSimulationScenariosInputSchema = z.object({
  limit, name: parameter<string>('scenarioName').optional(),
});

export const CreateSimulationPersonalityInputSchema = z.object({
  name: field<string>('CreatePersonalityDTO', 'name'),
  assistant: field<Record<string, unknown>>('CreatePersonalityDTO', 'assistant'),
  path: field<string | null | undefined>('CreatePersonalityDTO', 'path'),
});

export const CreateSimulationScenarioInputSchema = z.object({
  name: field<string>('CreateScenarioDTO', 'name'),
  instructions: field<string>('CreateScenarioDTO', 'instructions'),
  evaluations: field<Record<string, unknown>[]>('CreateScenarioDTO', 'evaluations'),
  path: field<string | null | undefined>('CreateScenarioDTO', 'path'),
  additionalFields,
}).superRefine((input, ctx) => {
  if (input.additionalFields) validateSimulationBody('CreateScenarioDTO', input, ctx);
});

export const CreateSimulationInputSchema = z.object({
  scenarioId: field<string>('CreateSimulationDTO', 'scenarioId'),
  personalityId: field<string>('CreateSimulationDTO', 'personalityId'),
  name: field<string | undefined>('CreateSimulationDTO', 'name'),
  path: field<string | null | undefined>('CreateSimulationDTO', 'path'),
});

export const CreateSimulationSuiteInputSchema = z.object({
  name: field<string>('CreateSimulationSuiteDTO', 'name'),
  simulationIds: field<string[]>('CreateSimulationSuiteDTO', 'simulationIds'),
  path: field<string | null | undefined>('CreateSimulationSuiteDTO', 'path'),
  additionalFields,
}).superRefine((input, ctx) => {
  if (input.additionalFields) validateSimulationBody('CreateSimulationSuiteDTO', input, ctx);
});

export const RunSimulationsInputSchema = z.object({
  assistantId: field<string>('SimulationRunTargetAssistant', 'assistantId').optional(),
  squadId: field<string>('SimulationRunTargetSquad', 'squadId').optional(),
  simulationIds: z.array(field<string>('SimulationRunSimulationEntry', 'simulationId')).optional(),
  suiteIds: z.array(field<string>('SimulationRunSuiteEntry', 'simulationSuiteId')).optional(),
  // The integral iteration count is an MCP adapter rule; bounds come from API.
  iterations: field<number>('CreateSimulationRunDTO', 'iterations').pipe(z.number().int()).optional(),
  transport: field<'vapi.websocket' | 'vapi.webchat'>('SimulationRunTransportConfiguration', 'provider').optional(),
  idempotencyKey: parameter<string>('idempotencyKey').optional(),
}).superRefine((input, ctx) => {
  if (!!input.assistantId === !!input.squadId) ctx.addIssue({
    code: 'custom', path: ['assistantId'], message: 'Give exactly one of assistantId or squadId.',
  });
  if (!(input.simulationIds?.length || input.suiteIds?.length)) ctx.addIssue({
    code: 'custom', path: ['simulationIds'], message: 'Give at least one simulationId or suiteId.',
  });
}).meta({ allOf: [
  { oneOf: [{ required: ['assistantId'] }, { required: ['squadId'] }] },
  { anyOf: [
    { required: ['simulationIds'], properties: { simulationIds: { minItems: 1 } } },
    { required: ['suiteIds'], properties: { suiteIds: { minItems: 1 } } },
  ] },
] });

export const ListSimulationRunsInputSchema = z.object({
  limit, status: parameter<'queued' | 'running' | 'ended'>('runStatus').optional(),
  targetId: parameter<string>('targetId').optional(),
});
export const GetSimulationRunInputSchema = z.object({ runId: parameter<string>('runId') });
// The item endpoint publishes plain strings, unlike the run endpoint's UUID.
export const GetSimulationRunItemInputSchema = z.object({
  runId: parameter<string>('itemRunId'), itemId: parameter<string>('itemId'),
});
