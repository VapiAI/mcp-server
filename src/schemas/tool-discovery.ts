import type { z } from 'zod';
import { inputContract } from './assistant-openapi.js';

type JsonSchema = z.core.JSONSchema.JSONSchema;
const annotations = new Set(['description', 'title', 'example', 'examples', 'default', 'discriminator', 'externalDocs', 'deprecated', 'readOnly', 'writeOnly']);
const maps = new Set(['properties', 'definitions', '$defs', 'patternProperties', 'dependentSchemas']);
const children = new Set(['items', 'additionalItems', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames']);
const arrays = new Set(['oneOf', 'anyOf', 'allOf', 'prefixItems']);

// Strip documentation at schema nodes, never at user-defined property names.
// Retain validation keywords, including enum/required/limits and recursive refs.
export function toolDiscoveryContract(value: JsonSchema | boolean): JsonSchema | boolean {
  if (typeof value === 'boolean') return value;
  const normalized = inputContract(value) as JsonSchema;
  function strip(schema: JsonSchema | boolean): JsonSchema | boolean {
    if (typeof schema === 'boolean') return schema;
    const result: JsonSchema = {};
    for (const [key, nested] of Object.entries(schema)) {
      if (annotations.has(key) || key === 'nullable' || key.startsWith('x-')) continue;
      if (key === '$ref' && typeof nested === 'string') result.$ref = nested.replace('#/components/schemas/', '#/definitions/');
      else if (maps.has(key) && nested && typeof nested === 'object') result[key] = Object.fromEntries(Object.entries(nested).map(([name, child]) => [name, strip(child as JsonSchema | boolean)]));
      else if (arrays.has(key) && Array.isArray(nested)) result[key] = nested.map(child => strip(child));
      else if (children.has(key) && nested !== null && typeof nested === 'object') result[key] = Array.isArray(nested) ? nested.map(child => strip(child)) : strip(nested as JsonSchema);
      else result[key] = nested;
    }
    // OpenAPI 3 nullable is not a JSON Schema validation keyword.
    return schema.nullable === true ? { anyOf: [result, { type: 'null' }] } : result;
  }
  return strip(normalized);
}

export function toolInputContract(variants: Record<string, string>, definitions: Record<string, JsonSchema>, id?: JsonSchema): JsonSchema {
  const selected: Record<string, JsonSchema> = {};
  const visit = (name: string) => {
    if (selected[name]) return;
    const schema = definitions[name];
    if (!schema) throw new Error(`Missing tool schema: ${name}`);
    selected[name] = schema;
    for (const match of JSON.stringify(schema).matchAll(/#\/components\/schemas\/([\w.-]+)/g)) visit(match[1]);
  };
  Object.values(variants).forEach(visit);
  if (id) {
    // The update handler merges sparse function/server edits with saved values
    // before validating the complete DTO. Describe those patch objects here;
    // nested constraints (parameters, headers, etc.) still apply unchanged.
    const partialObject = (node: JsonSchema): JsonSchema => {
      if (node.$ref) return partialObject(definitions[node.$ref.split('/').at(-1)!]);
      const { required, ...partial } = node;
      return { ...partial, ...(partial.allOf ? { allOf: partial.allOf.map(branch => partialObject(branch as JsonSchema)) } : {}) };
    };
    for (const name of Object.values(variants)) {
      const schema = selected[name];
      const properties = { ...schema.properties };
      for (const key of ['function', 'server']) {
        if (properties[key] && typeof properties[key] !== 'boolean') properties[key] = partialObject(properties[key]);
      }
      selected[name] = { ...schema, properties };
    }
  }
  const references = Object.values(variants).map(name => ({ $ref: `#/components/schemas/${name}` }));
  const schema: JsonSchema = {
    type: 'object',
    properties: { ...(id ? { id } : {}), type: { type: 'string', enum: Object.keys(variants) } },
    required: [id ? 'id' : 'type'],
    // Update DTOs have optional discriminators, so their branches can overlap.
    [id ? 'anyOf' : 'oneOf']: references,
    definitions: selected,
  };
  return shareRepeatedSchemas(toolDiscoveryContract(schema) as JsonSchema);
}

// Lossless structural sharing. Only schema nodes are interned; property maps,
// enum values and other user data are never interpreted as schemas.
function shareRepeatedSchemas(root: JsonSchema): JsonSchema {
  const counts = new Map<string, number>();
  const nodes = new Map<string, JsonSchema>();
  const mapChildren = (schema: JsonSchema, visit: (node: JsonSchema | boolean) => JsonSchema | boolean): JsonSchema => Object.fromEntries(Object.entries(schema).map(([key, value]) => {
    if (maps.has(key) && value && typeof value === 'object') return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, visit(child as JsonSchema | boolean)]))];
    if (arrays.has(key) && Array.isArray(value)) return [key, value.map(visit)];
    if (children.has(key) && value !== null && typeof value === 'object') return [key, Array.isArray(value) ? value.map(visit) : visit(value as JsonSchema)];
    return [key, value];
  }));
  const count = (node: JsonSchema | boolean): JsonSchema | boolean => {
    if (typeof node === 'boolean') return node;
    const key = JSON.stringify(node);
    // A reference has overhead too; sharing smaller nodes would grow the result.
    if (!node.$ref && key.length > 80) { counts.set(key, (counts.get(key) ?? 0) + 1); nodes.set(key, node); }
    mapChildren(node, count);
    return node;
  };
  count(root);
  const names = new Map([...counts].filter(([, count]) => count > 1).map(([key], index) => [key, `__shared_${index}`]));
  const share = (node: JsonSchema | boolean): JsonSchema | boolean => {
    if (typeof node === 'boolean') return node;
    const name = names.get(JSON.stringify(node));
    return name ? { $ref: `#/definitions/${name}` } : mapChildren(node, share);
  };
  const result = mapChildren(root, share);
  const all: Record<string, JsonSchema> = { ...result.definitions as Record<string, JsonSchema> };
  for (const [key, name] of names) {
    if (Object.hasOwn(all, name)) throw new Error(`Shared schema name collision: ${name}`);
    all[name] = mapChildren(nodes.get(key)!, share);
  }
  // Parent sharing may make some original or factored definitions unreachable.
  const reachable: Record<string, JsonSchema> = {};
  const visitRefs = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('$ref' in value && typeof value.$ref === 'string') {
      const name = value.$ref.replace('#/definitions/', '');
      if (!Object.hasOwn(reachable, name)) {
        if (!all[name]) throw new Error(`Missing shared definition: ${name}`);
        reachable[name] = all[name]; visitRefs(all[name]);
      }
    }
    Object.values(value).forEach(visitRefs);
  };
  const { definitions: unused, ...envelope } = result;
  visitRefs(envelope);
  return { ...envelope, definitions: reachable };
}
