import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { inputContract } from './assistant-openapi.js';

type JsonSchema = z.core.JSONSchema.JSONSchema;
type Snapshot = {
  schemas: Record<string, JsonSchema>;
  parameters: Record<string, JsonSchema>;
  definitions: Record<string, JsonSchema>;
};
const snapshot: Snapshot = JSON.parse(readFileSync(new URL('./simulation-openapi.json', import.meta.url), 'utf8'));

export function simulationContract(name: string): JsonSchema {
  const schema = snapshot.schemas[name] ?? snapshot.parameters[name] ?? snapshot.definitions[name];
  if (!schema) throw new Error(`Unknown simulation contract: ${name}`);
  return JSON.parse(JSON.stringify(inputContract({ ...schema, definitions: snapshot.definitions }), (key, value) =>
    key === '$ref' && typeof value === 'string' ? value.replace('#/components/schemas/', '#/definitions/') : value));
}
const validators = new Map<string, z.ZodType>();
export function simulationValidator(name: string): z.ZodType {
  let validator = validators.get(name);
  if (!validator) {
    validator = z.fromJSONSchema(simulationContract(name), { defaultTarget: 'openapi-3.0' });
    validators.set(name, validator);
  }
  return validator;
}

// Full assistant/structured-output DTOs expand to hundreds of MB if converted
// back to inline tool JSON. Advertise compact object envelopes for these fields,
// while validating their complete published contracts at the same boundary.
function compact(schema: JsonSchema | boolean): JsonSchema | boolean {
  if (typeof schema === 'boolean') return schema;
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1)!;
    return compact(inputContract(snapshot.definitions[name]) as JsonSchema);
  }
  const result = { ...schema };
  delete result.definitions;
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (result[key]) result[key] = result[key]!.map(compact) as JsonSchema[];
  }
  if (result.items && !Array.isArray(result.items)) result.items = compact(result.items);
  if (result.properties) result.properties = Object.fromEntries(Object.entries(result.properties).map(([key, value]) => [key,
    ['assistant', 'structuredOutput', 'targetOverrides'].includes(key)
      ? { type: 'object', additionalProperties: true, description: `Full ${key} configuration, validated against the bundled Vapi OpenAPI schema. See https://api.vapi.ai/api-json.` }
      : compact(value),
  ]));
  return result;
}

function advertised<T>(validator: z.ZodType, contract: JsonSchema | boolean): z.ZodType<T> {
  return z.any().superRefine((value, ctx) => {
    const result = validator.safeParse(value);
    if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ ...issue });
    // Preserve the submitted payload: imported defaults are annotations and
    // unknown documented extension fields must not disappear during parsing.
  }).meta(compact(contract) as JsonSchema) as z.ZodType<T>;
}

export function simulationParameter<T>(name: string): z.ZodType<T> {
  return advertised<T>(simulationValidator(name), simulationContract(name));
}

export function simulationField<T>(dto: string, field: string): z.ZodType<T> {
  const validator = simulationValidator(dto);
  if (!(validator instanceof z.ZodObject)) throw new Error(`${dto} must be an object schema`);
  const contract = simulationContract(dto).properties?.[field];
  if (!contract || !validator.shape[field]) throw new Error(`Missing simulation field: ${dto}.${field}`);
  const result = advertised<T>(validator.shape[field], field === 'assistant'
    ? { type: 'object', additionalProperties: true, description: 'Full tester assistant configuration, validated against the bundled Vapi OpenAPI schema. See https://api.vapi.ai/api-json (TransientAssistantDTO).' }
    : contract);
  return simulationContract(dto).required?.includes(field) ? result : result.optional() as z.ZodType<T>;
}

export function validateSimulationBody(dto: string, input: Record<string, unknown>, ctx: z.RefinementCtx) {
  const { additionalFields, ...fields } = input;
  const extra = additionalFields as Record<string, unknown> | undefined;
  const result = simulationValidator(dto).safeParse({ ...fields, ...extra });
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({
    ...issue,
    path: extra && Object.hasOwn(extra, issue.path[0]) ? ['additionalFields', ...issue.path] : issue.path,
  });
}
