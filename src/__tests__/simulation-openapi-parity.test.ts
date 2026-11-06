import { expect, test } from '@jest/globals';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { simulationContract, simulationValidator } from '../schemas/simulation-openapi.js';
import { inputContract } from '../schemas/assistant-openapi.js';

const id = '00000000-0000-4000-8000-000000000001';
const cases: Record<string, unknown[]> = {
  CreatePersonalityDTO: [
    {}, { name: 'Test', assistant: {} }, { name: 'x'.repeat(81), assistant: {} },
    { name: 'Test', assistant: { maxDurationSeconds: 1 } },
    { name: 'Test', assistant: { model: { provider: 'openai', model: 'gpt-4o' } } },
    { name: 'Test', assistant: { model: { provider: 'unknown' } } },
    { name: 'Test', assistant: {}, path: 'a/b/c' }, { name: 'Test', assistant: {}, path: '/bad' },
  ],
  CreateScenarioDTO: [
    {}, { name: 'Test', instructions: 'Help', evaluations: [] },
    { name: 'Test', instructions: 'x'.repeat(10001), evaluations: [] },
    ...[id, 'bad'].map(structuredOutputId => ({ name: 'Test', instructions: 'Help', evaluations: [{ structuredOutputId, comparator: '=', value: true }] })),
    ...[{ name: 'Extract', schema: { type: 'boolean' } }, { name: 'Extract' }, { name: '', schema: { type: 'bad' } }].map(structuredOutput => ({ name: 'Test', instructions: 'Help', evaluations: [{ structuredOutput, comparator: '=', value: true }] })),
  ],
  CreateSimulationDTO: [{}, { scenarioId: id, personalityId: id }, { scenarioId: 'bad', personalityId: id }, { scenarioId: id, personalityId: id, path: null }],
  CreateSimulationSuiteDTO: [{}, { name: 'Test', simulationIds: [id] }, { name: 'Test', simulationIds: [42] }, { name: 'x'.repeat(81), simulationIds: [] }],
  CreateSimulationRunDTO: [
    {}, ...[0, 1, 10, 11].map(iterations => ({ simulations: [{ type: 'simulation', simulationId: id }], target: { type: 'assistant', assistantId: id }, iterations })),
    { simulations: [{ type: 'simulation', simulationId: 'bad' }], target: { type: 'assistant', assistantId: id } },
  ],
};
test.each(Object.entries(cases))('%s agrees with independent JSON Schema validation', (name, values) => {
  const ajv = new Ajv({ strict: false });
  addFormats.default(ajv);
  const reference = ajv.compile(simulationContract(name));
  for (const input of values) expect({ input, accepted: simulationValidator(name).safeParse(input).success })
    .toEqual({ input, accepted: reference(input) });
});

test('normalization preserves property names that coincide with JSON Schema keywords', () => {
  const properties = { oneOf: { type: 'array' }, default: { type: 'boolean', default: true } };
  expect(inputContract({ type: 'object', properties })).toEqual({
    type: 'object', properties: { oneOf: { type: 'array' }, default: { type: 'boolean' } },
  });
  expect(inputContract({ type: 'string', enum: [] })).toEqual({ not: {} });
});
