import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const url = 'https://api.vapi.ai/api-json';
const source = process.argv[2] ? await readFile(process.argv[2], 'utf8') : await (async () => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`OpenAPI fetch failed: HTTP ${response.status}`);
  return response.text();
})();
const spec = JSON.parse(source);
const definitions = {};
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) {
    const name = value.$ref.split('/').at(-1);
    if (!definitions[name]) {
      if (!spec.components.schemas[name]) throw new Error(`Missing definition: ${name}`);
      definitions[name] = spec.components.schemas[name];
      visit(definitions[name]);
    }
  }
  Object.values(value).forEach(visit);
}
const operations = {};
for (const [name, path, method] of [['create_tool', '/tool', 'post'], ['update_tool', '/tool/{id}', 'patch']]) {
  const contract = spec.paths[path][method].requestBody.content['application/json'].schema;
  operations[name] = Object.fromEntries(contract.oneOf.map(ref => {
    const dto = ref.$ref.split('/').at(-1);
    const type = spec.components.schemas[dto].properties.type.enum[0];
    visit(ref);
    return [type, dto];
  }));
}
const id = spec.paths['/tool/{id}'].patch.parameters.find(p => p.name === 'id' && p.in === 'path').schema;
await writeFile(new URL('../src/schemas/tool-openapi.json', import.meta.url), JSON.stringify({
  source: { url, sha256: createHash('sha256').update(source).digest('hex') }, operations, id, definitions,
}, null, 2) + '\n');
