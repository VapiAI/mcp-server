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
};

const snapshot: Snapshot = JSON.parse(readFileSync(new URL('./assistant-openapi.json', import.meta.url), 'utf8'));

// The published spec uses overlapping oneOf [enum, string] branches for preset
// IDs and model names. The API accepts both. Change only this recognizable
// pattern, leaving discriminated/exclusive unions intact.
function inputContract(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inputContract);
  if (!value || typeof value !== 'object') return value;
  const schema = value as Record<string, unknown>;
  const alternatives = schema.oneOf as JsonSchema[] | undefined;
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
      key === 'enum' && Array.isArray(nested) ? [...new Set(nested)] : inputContract(nested),
    ]));
}

export function providerContract(field: 'voice' | 'transcriber'): JsonSchema {
  const supported = snapshot[field].filter(definition =>
    definition.required.every(key => key in definition.properties));
  return {
    oneOf: supported.map(definition => ({
      type: 'object',
      required: definition.required,
      properties: inputContract(definition.properties) as Record<string, JsonSchema>,
      // API DTOs reject undeclared provider fields. In particular, a provider
      // without a model property must reject model, not silently accept it.
      additionalProperties: false,
    })),
  };
}

// Providers requiring fields outside the existing compact MCP surface stay
// unsupported, rather than having those API-required fields silently dropped.
export const providersRequiringExpandedInputs = Object.fromEntries(
  (['voice', 'transcriber'] as const).map(field => [field, snapshot[field]
    .filter(definition => definition.required.some(key => !(key in definition.properties)))
    .map(definition => definition.name)])
);

type VoiceConfiguration = { provider: string; voiceId: string; model?: string };
type TranscriberConfiguration = { provider: string; model?: string };

// fromJSONSchema validates at runtime but intentionally returns an untyped
// ZodType. These types describe the projected fields, not a second validator.
export const VoiceInputSchema = z.fromJSONSchema(providerContract('voice'), { defaultTarget: 'openapi-3.0' }) as z.ZodType<VoiceConfiguration>;
export const TranscriberInputSchema = z.fromJSONSchema(providerContract('transcriber'), { defaultTarget: 'openapi-3.0' }) as z.ZodType<TranscriberConfiguration>;
export const CreateAssistantNameSchema = z.fromJSONSchema(snapshot.name.create, { defaultTarget: 'openapi-3.0' }) as z.ZodType<string>;
export const UpdateAssistantNameSchema = z.fromJSONSchema(snapshot.name.update, { defaultTarget: 'openapi-3.0' }) as z.ZodType<string>;
