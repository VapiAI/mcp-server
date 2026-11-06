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
for (const field of ['voice', 'transcriber']) {
  const keys = field === 'voice' ? ['provider', 'voiceId', 'model'] : ['provider', 'model'];
  fields[field] = schemas.CreateAssistantDTO.properties[field].oneOf.map(({ $ref }) => {
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
const snapshot = {
  source: { url, sha256: createHash('sha256').update(source).digest('hex') },
  name: {
    create: schemas.CreateAssistantDTO.properties.name,
    update: schemas.UpdateAssistantDTO.properties.name,
  },
  ...fields,
};
// This projection is deliberately small and standalone. Fail instead of
// introducing unresolved references on an upstream schema change.
if (JSON.stringify(snapshot).includes('"$ref"')) throw new Error('Projected fields now require reference handling');
await writeFile(new URL('../src/schemas/assistant-openapi.json', import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log('Saved assistant name and provider field contracts');
