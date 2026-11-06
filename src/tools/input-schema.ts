import type { z } from 'zod';

type JsonSchema = z.core.JSONSchema.JSONSchema;
type SchemaType = Exclude<NonNullable<JsonSchema['type']>, unknown[]>;

// tools/list describes how to call a tool. Provider catalogs and recursive API
// definitions belong in on-demand schema lookup, not every agent's tool context.
// This projection is intentionally broader than the unchanged runtime validator.
export function summarizeInputSchema(schema: JsonSchema): JsonSchema {
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives?.length && alternatives.every(branch => branch.type === 'object' && branch.properties?.provider)) {
    const keys = [...new Set(alternatives.flatMap(branch => Object.keys(branch.properties!)))];
    return {
      type: 'object',
      properties: Object.fromEntries(keys.map(key => [key, typeSummary(alternatives.flatMap(branch =>
        branch.properties?.[key] ? [branch.properties[key]] : []))])),
      required: (alternatives[0].required ?? []).filter(key => alternatives.every(branch => branch.required?.includes(key))),
      additionalProperties: false,
      ...(schema.description ? { description: schema.description } : {}),
    };
  }

  // Do not expand recursive JSON Schema definitions in the advertised contract.
  // An empty schema accepts the value; the runtime validator still checks it.
  if (schema.$ref) return {};

  const summary: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    // Dropping a negative constraint broadens discovery; simplifying its
    // contents could instead reject values accepted by the runtime schema.
    if (['definitions', '$defs', '$schema', 'title', 'example', 'examples', 'not'].includes(key)) continue;
    if (key === 'description' && typeof value === 'string' && value.length > 180) continue;
    if (key === 'enum' && Array.isArray(value) && value.length > 8) continue;
    if (key === 'properties') {
      summary.properties = Object.fromEntries(Object.entries(value as Record<string, JsonSchema>)
        .map(([name, field]) => [name, typeof field === 'boolean' ? field : summarizeInputSchema(field)]));
    } else if (['oneOf', 'anyOf', 'allOf'].includes(key)) {
      // Relaxed branches can overlap, so discovery must not require exclusivity.
      summary[key === 'oneOf' ? 'anyOf' : key] = (value as JsonSchema[]).map(summarizeInputSchema);
    } else if (['items', 'additionalProperties', 'then', 'else'].includes(key) && typeof value === 'object' && value !== null) {
      summary[key] = summarizeInputSchema(value as JsonSchema);
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

function typeSummary(schemas: (JsonSchema | boolean)[]): JsonSchema {
  if (schemas.some(schema => typeof schema === 'boolean' || !schemaTypes(schema).length)) return {};
  const types = [...new Set(schemas.flatMap(schemaTypes))];
  return types.length === 1 ? { type: types[0] } : types.length ? { type: types } : {};
}

function schemaTypes(schema: JsonSchema | boolean): SchemaType[] {
  if (typeof schema === 'boolean') return [];
  if (schema.type) return Array.isArray(schema.type) ? schema.type : [schema.type];
  return (schema.oneOf ?? schema.anyOf ?? []).flatMap(schemaTypes);
}
