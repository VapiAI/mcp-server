import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const url = 'https://api.vapi.ai/api-json';
const cacheDirectory = new URL('../.cache/vapi/', import.meta.url);
const cachedSpec = new URL('openapi-source.json', cacheDirectory);

async function fetchSpec() {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`OpenAPI fetch failed: HTTP ${response.status}`);
  return response.text();
}

async function loadOpenApiSource(input) {
  let raw;
  if (!input) {
    try {
      raw = await readFile(cachedSpec, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const cacheSource = raw === undefined;
  raw ??= input && input !== '--refresh' ? await readFile(input, 'utf8') : await fetchSpec();
  const spec = JSON.parse(raw);
  if (spec.openapi !== '3.0.0') throw new Error(`Unexpected dialect: ${spec.openapi}`);

  if (cacheSource) {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cachedSpec, raw);
  }

  return { spec, source: { url, sha256: createHash('sha256').update(raw).digest('hex') } };
}

export const { spec, source } = await loadOpenApiSource(process.argv[2]);
