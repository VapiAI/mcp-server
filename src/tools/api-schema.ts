import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, VapiEnvironment } from '@vapi-ai/server-sdk';

import { GetApiSchemaInputSchema } from '../schemas/index.js';
import { createToolHandler } from './utils.js';
import { readOnly } from './annotations.js';
import { toolOperations, toolDefinitions, toolSchemaSource, toolExamples } from '../schemas/tool-openapi.js';

type SchemaMap = Record<string, unknown>;

// The OpenAPI spec is about 2 MB, so load it once per client and keep only
// its schemas. It is fetched through the client so it comes from the same
// API environment the other tools call.
const schemaCache = new WeakMap<VapiClient, Promise<SchemaMap>>();

type Supplier = string | (() => string | Promise<string>) | undefined;

// vapiClient.fetch resolves relative paths only against an explicitly
// configured base URL, so resolve it the way the SDK's own resource clients
// do: baseUrl, then environment, then the default API host.
async function resolveBaseUrl(vapiClient: VapiClient): Promise<string> {
  const options = (
    vapiClient as unknown as {
      _options?: { baseUrl?: Supplier; environment?: Supplier };
    }
  )._options;
  const get = async (supplier: Supplier) =>
    typeof supplier === 'function' ? await supplier() : supplier;
  return (
    (await get(options?.baseUrl)) ??
    (await get(options?.environment)) ??
    VapiEnvironment.Default
  );
}

function loadSchemas(vapiClient: VapiClient): Promise<SchemaMap> {
  let schemas = schemaCache.get(vapiClient);
  if (!schemas) {
    schemas = resolveBaseUrl(vapiClient)
      .then((baseUrl) =>
        vapiClient.fetch(`${baseUrl.replace(/\/+$/, '')}/api-json`)
      )
      .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Could not load the Vapi API schema: HTTP ${response.status}`
        );
      }
      const spec = (await response.json()) as {
        components?: { schemas?: SchemaMap };
      };
      return spec.components?.schemas ?? {};
    });
    // Let the next call retry after a failed load.
    schemas.catch(() => schemaCache.delete(vapiClient));
    schemaCache.set(vapiClient, schemas);
  }
  return schemas;
}

function findSchemaNames(schemas: SchemaMap, text: string): string[] {
  const needle = text.toLowerCase();
  return Object.keys(schemas)
    .filter((name) => name.toLowerCase().includes(needle))
    .sort();
}

const MAX_MATCHES = 50;

export const registerApiSchemaTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  server.registerTool(
    'get_api_schema',
    {
      description:
        'Looks up a schema in the Vapi API reference (the OpenAPI spec the Vapi SDKs are generated from). ' +
        'Pass `search` to find schema names, then `name` to get one schema. ' +
        'References to other schemas are left as "#/components/schemas/<Name>" and listed in referencedSchemas, so look those up next if you need them. ' +
        'For the exact tool configuration contracts accepted by this MCP version, pass tool="create_tool" or "update_tool". ' +
        'Without name, that returns supported types and their schema names; with name, it returns that bundled schema, including published examples. ' +
        'Follow referencedSchemas with the same tool argument. Other lookups use the live API schema.',
      inputSchema: GetApiSchemaInputSchema.shape,
      annotations: readOnly('Get API Schema'),
    },
    createToolHandler(async (data) => {
      if (data.tool && !data.name && !data.search) {
        return {
          source: toolSchemaSource,
          tool: data.tool,
          types: Object.entries(toolOperations[data.tool]).map(([type, schema]) => ({ type, schema })),
          guidance: 'Look up a schema name with the same tool argument, then follow referencedSchemas. Published examples appear in schema properties. Optional worked examples: load_skill({name:"create-tool"}), then request its referenced files with load_skill.',
        };
      }
      const schemas = data.tool ? toolDefinitions : await loadSchemas(vapiClient);

      if (data.name) {
        const schema = schemas[data.name];
        if (!schema) {
          const similar = findSchemaNames(schemas, data.name).slice(0, 10);
          throw new Error(
            `No schema named ${data.name}.` +
              (similar.length > 0 ? ` Similar names: ${similar.join(', ')}` : '')
          );
        }
        const referencedSchemas = [
          ...new Set(
            Array.from(
              JSON.stringify(schema).matchAll(/#\/components\/schemas\/([\w.-]+)/g),
              (match) => match[1]
            )
          ),
        ];
        return { name: data.name, schema, referencedSchemas,
          ...(data.tool ? { source: toolSchemaSource, examples: toolExamples[data.name] ?? [] } : {}),
        };
      }

      const matches = findSchemaNames(schemas, data.search ?? '');
      return { matches: matches.slice(0, MAX_MATCHES), total: matches.length };
    })
  );
};
