import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const url = 'https://api.vapi.ai/api-json';
let source;
if (process.argv[2]) source = await readFile(process.argv[2], 'utf8');
else {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`OpenAPI fetch failed: HTTP ${response.status}`);
  source = await response.text();
}
const spec = JSON.parse(source);
if (spec.openapi !== '3.0.0') throw new Error(`Unexpected dialect: ${spec.openapi}`);
const schemas = spec.components.schemas;
const fields = {};
for (const field of ['voice', 'transcriber', 'llm']) {
  const keys = field === 'voice' ? ['provider', 'voiceId', 'model'] : ['provider', 'model'];
  const apiField = field === 'llm' ? 'model' : field;
  fields[field] = schemas.CreateAssistantDTO.properties[apiField].oneOf.map(({ $ref }) => {
    const name = $ref.split('/').at(-1);
    const schema = schemas[name];
    return {
      name,
      // Keep the original required list, including fields outside the MCP
      // surface, so projection cannot accidentally relax a provider contract.
      required: schema.required,
      properties: Object.fromEntries(keys.filter(key => schema.properties[key]).map(key => [key, schema.properties[key]])),
    };
  });
}
const property = (schema, key) => {
  const result = schemas[schema]?.properties?.[key];
  if (!result) throw new Error(`Missing published field: ${schema}.${key}`);
  return result;
};
const apiFields = {
  firstMessage: property('CreateAssistantDTO', 'firstMessage'),
  firstMessageMode: property('CreateAssistantDTO', 'firstMessageMode'),
  toolIds: property('OpenAIModel', 'toolIds'),
  instructions: property('OpenAIMessage', 'content'),
  callAssistantId: property('CreateCallDTO', 'assistantId'),
  callPhoneNumberId: property('CreateCallDTO', 'phoneNumberId'),
  customerNumber: property('CreateCustomerDTO', 'number'),
  scheduledAt: property('SchedulePlan', 'earliestAt'),
  variableValues: property('AssistantOverrides', 'variableValues'),
  functionName: property('OpenAIFunction', 'name'),
  functionDescription: property('OpenAIFunction', 'description'),
  functionParameters: property('OpenAIFunction', 'parameters'),
  serverUrl: property('Server', 'url'),
  serverHeaders: property('Server', 'headers'),
  apiUrl: property('CreateApiRequestToolDTO', 'url'),
  apiMethod: property('CreateApiRequestToolDTO', 'method'),
  apiBody: property('CreateApiRequestToolDTO', 'body'),
  apiTimeout: property('CreateApiRequestToolDTO', 'timeoutSeconds'),
  backoffType: property('BackoffPlan', 'type'),
  backoffMaxRetries: property('BackoffPlan', 'maxRetries'),
  backoffDelay: property('BackoffPlan', 'baseDelaySeconds'),
};
const transferProperties = ['type', 'number', 'extension', 'callerId', 'description'];
apiFields.transferDestination = {
  type: 'object', required: schemas.TransferDestinationNumber.required,
  properties: Object.fromEntries(transferProperties.map(key => [key, property('TransferDestinationNumber', key)])),
};
apiFields.toolType = { oneOf: ['CreateSmsToolDTO', 'CreateTransferCallToolDTO', 'CreateFunctionToolDTO', 'CreateApiRequestToolDTO']
  .map(name => property(name, 'type')) };
for (const [key, path] of Object.entries({ assistantId: '/assistant/{id}', callId: '/call/{id}', phoneNumberId: '/phone-number/{id}', toolId: '/tool/{id}' })) {
  apiFields[key] = spec.paths[path].get.parameters.find(parameter => parameter.in === 'path' && parameter.name === 'id').schema;
}
const definitions = {};
function closeReferences(value) {
  if (Array.isArray(value)) return value.forEach(closeReferences);
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') {
    const prefix = '#/components/schemas/';
    if (!value.$ref.startsWith(prefix)) throw new Error(`Unsupported reference: ${value.$ref}`);
    const name = value.$ref.slice(prefix.length);
    if (!schemas[name]) throw new Error(`Missing reference: ${name}`);
    if (!definitions[name]) { definitions[name] = schemas[name]; closeReferences(schemas[name]); }
  }
  Object.values(value).forEach(closeReferences);
}
closeReferences(apiFields);
const snapshot = {
  source: { url, sha256: createHash('sha256').update(source).digest('hex') },
  name: {
    create: schemas.CreateAssistantDTO.properties.name,
    update: schemas.UpdateAssistantDTO.properties.name,
  },
  ...fields,
  fields: apiFields,
  definitions,
  requiredToolConfigurations: ['CreateSmsToolDTO', 'CreateTransferCallToolDTO', 'CreateFunctionToolDTO', 'CreateApiRequestToolDTO']
    .filter(name => (schemas[name].required ?? []).some(key => key !== 'type'))
    .map(name => schemas[name].properties.type.enum[0]),
  functionRequiresName: schemas.OpenAIFunction.required.includes('name'),
};
await writeFile(new URL('../src/schemas/assistant-openapi.json', import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log('Saved compact input contracts for all current MCP tool surfaces');
