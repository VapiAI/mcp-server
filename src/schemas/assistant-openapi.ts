import { readFileSync } from 'node:fs';
import { z } from 'zod';

type JsonSchema = z.core.JSONSchema.JSONSchema;
type ProviderDefinition = {
  name: string;
  required: string[];
  properties: Record<string, JsonSchema>;
};
type Snapshot = {
  name: { create: JsonSchema; update: JsonSchema };
  voice: ProviderDefinition[];
  transcriber: ProviderDefinition[];
  llm: ProviderDefinition[];
  fields: Record<string, JsonSchema>;
  definitions: Record<string, JsonSchema>;
  requiredToolConfigurations: string[];
  functionRequiresName: boolean;
};

const snapshot: Snapshot = JSON.parse(readFileSync(new URL('./assistant-openapi.json', import.meta.url), 'utf8'));
export const requiredToolConfigurations = snapshot.requiredToolConfigurations;
export const functionRequiresName = snapshot.functionRequiresName;

// The published spec uses overlapping oneOf [enum, string] branches for preset
// IDs and model names. The API accepts both. Change only this recognizable
// pattern, leaving discriminated/exclusive unions intact.
export function inputContract(value: unknown, schemaMap = false): unknown {
  if (Array.isArray(value)) return value.map(item => inputContract(item));
  if (!value || typeof value !== 'object') return value;
  const schema = value as Record<string, unknown>;
  // Property names such as oneOf/default are user-defined keys in schema maps,
  // rather than JSON Schema keywords. Preserve them and normalize their values.
  if (schemaMap) return Object.fromEntries(Object.entries(schema).map(([key, nested]) => [key, inputContract(nested)]));
  // An empty published preset enum denotes no preset values. Represent that
  // branch as an always-failing schema so it remains valid JSON Schema.
  if (Array.isArray(schema.enum) && schema.enum.length === 0) return { not: {} };
  const alternatives = Array.isArray(schema.oneOf) ? schema.oneOf as JsonSchema[] : undefined;
  const overlap = alternatives?.some(branch => branch.type === 'string' &&
    Object.keys(branch).every(key => ['type', 'title', 'description'].includes(key))) &&
    alternatives.some(branch => branch.type === 'string' && Array.isArray(branch.enum));
  return Object.fromEntries(Object.entries(schema)
    // OpenAPI defaults are annotations; preserve omitted input fields and let
    // the API apply its defaults rather than materializing them in requests.
    .filter(([key]) => key !== 'default')
    .map(([key, nested]) => [
      key === 'oneOf' && overlap ? 'anyOf' : key,
      // Some published voice IDs repeat in enum arrays. Deduplication changes
      // no accepted values and keeps the result valid JSON Schema for Ajv.
      key === 'enum' && Array.isArray(nested) ? [...new Set(nested)]
        // Published name patterns include JavaScript /.../ delimiters, while
        // JSON Schema pattern expects the regex source without delimiters.
        : key === 'pattern' && typeof nested === 'string' && nested.startsWith('/') && nested.endsWith('/') ? nested.slice(1, -1)
        // BackoffPlan.type is published as object with a string enum. Keep the
        // enum's actual value type; the incompatible type annotation is a spec defect.
        : key === 'type' && nested === 'object' && Array.isArray(schema.enum) && schema.enum.every(v => typeof v === 'string') ? 'string'
        : ['properties', 'definitions', '$defs', 'patternProperties', 'dependentSchemas'].includes(key) ? inputContract(nested, true)
        : ['allOf', 'anyOf', 'oneOf', 'not', 'items', 'additionalProperties', 'contains', 'if', 'then', 'else'].includes(key) ? inputContract(nested)
        : nested,
    ]));
}

export function providerContract(field: 'voice' | 'transcriber' | 'llm'): JsonSchema {
  const supported = snapshot[field].filter(definition =>
    definition.required.every(key => key in definition.properties));
  return {
    oneOf: supported.map(definition => ({
      type: 'object',
      required: definition.required,
      properties: inputContract(definition.properties, true) as Record<string, JsonSchema>,
      // API DTOs reject undeclared provider fields. In particular, a provider
      // without a model property must reject model, not silently accept it.
      additionalProperties: false,
    })),
  };
}

// Providers requiring fields outside the existing compact MCP surface stay
// unsupported, rather than having those API-required fields silently dropped.
export const providersRequiringExpandedInputs = Object.fromEntries(
  (['voice', 'transcriber', 'llm'] as const).map(field => [field, snapshot[field]
    .filter(definition => definition.required.some(key => !(key in definition.properties)))
    .map(definition => definition.name)])
);

type VoiceConfiguration = { provider: string; voiceId: string; model?: string };
type TranscriberConfiguration = {
  provider: string;
  model?: string;
  language?: string;
  numerals?: boolean;
  keyterm?: string[];
};

// fromJSONSchema validates at runtime but intentionally returns an untyped
// ZodType. These types describe the projected fields, not a second validator.
export const VoiceInputSchema = z.fromJSONSchema(providerContract('voice'), { defaultTarget: 'openapi-3.0' }) as z.ZodType<VoiceConfiguration>;
export const TranscriberInputSchema = z.fromJSONSchema(providerContract('transcriber'), { defaultTarget: 'openapi-3.0' }) as z.ZodType<TranscriberConfiguration>;
export const CreateAssistantNameSchema = z.fromJSONSchema(snapshot.name.create, { defaultTarget: 'openapi-3.0' }) as z.ZodType<string>;
export const UpdateAssistantNameSchema = z.fromJSONSchema(snapshot.name.update, { defaultTarget: 'openapi-3.0' }) as z.ZodType<string>;

export const LLMInputSchema = z.fromJSONSchema(providerContract('llm'), { defaultTarget: 'openapi-3.0' }) as z.ZodType<{ provider: string; model?: string }>;

export function fieldContract(name: string): JsonSchema {
  const field = snapshot.fields[name];
  if (!field) throw new Error(`Unknown API input field: ${name}`);
  return JSON.parse(JSON.stringify(inputContract({ ...field, definitions: snapshot.definitions }), (key, value) =>
    key === '$ref' && typeof value === 'string' ? value.replace('#/components/schemas/', '#/definitions/') : value));
}

export function apiField<T = unknown>(name: string, overrides: Partial<JsonSchema> = {}): z.ZodType<T> {
  return z.fromJSONSchema({ ...fieldContract(name), ...overrides }, { defaultTarget: 'openapi-3.0' }) as z.ZodType<T>;
}

export function apiObjectField<T = Record<string, unknown>>(name: string): z.ZodType<T> {
  const schema = apiField(name);
  if (!(schema instanceof z.ZodObject)) throw new Error(`${name} is no longer an object schema`);
  // Preserve the existing MCP policy of stripping unknown envelope fields.
  return schema.strip() as z.ZodType<T>;
}
