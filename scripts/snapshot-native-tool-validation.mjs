import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const url = 'https://api.vapi.ai/api-json';
const source = process.argv[2] ? await readFile(process.argv[2], 'utf8') : await (async () => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`OpenAPI fetch failed: HTTP ${response.status}`);
  return response.text();
})();
const schemas = JSON.parse(source).components.schemas;
const fields = Object.fromEntries(['messages', 'rejectionPlan'].map(key => {
  const dtmf = schemas.CreateDtmfToolDTO.properties[key];
  if (JSON.stringify(dtmf) !== JSON.stringify(schemas.CreateEndCallToolDTO.properties[key])) {
    throw new Error(`Native tool contracts differ for ${key}`);
  }
  return [key, dtmf];
}));
const definitions = {};
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) {
    const name = value.$ref.split('/').at(-1);
    if (!definitions[name]) {
      if (!schemas[name]) throw new Error(`Missing definition: ${name}`);
      definitions[name] = schemas[name];
      visit(definitions[name]);
    }
  }
  Object.values(value).forEach(visit);
}
visit(fields);
await writeFile(new URL('../src/schemas/native-tool-openapi.json', import.meta.url), JSON.stringify({
  source: { url, sha256: createHash('sha256').update(source).digest('hex') }, fields, definitions,
}, null, 2) + '\n');
