import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const url = 'https://api.vapi.ai/api-json';
const sdk = '@vapi-ai/server-sdk';
const { dependencies } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const { packages } = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const sdkVersion = packages[`node_modules/${sdk}`]?.version;
if (!sdkVersion || dependencies[sdk] !== sdkVersion) {
  throw new Error(`Pin ${sdk} to the exact version in package-lock.json before generating OpenAPI snapshots.`);
}

const specFile = new URL(`../openapi/vapi-sdk-${sdkVersion}.json`, import.meta.url);
const refresh = process.argv[2] === '--refresh';

async function readSpec() {
  if (refresh) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`OpenAPI fetch failed: HTTP ${response.status}`);
    return response.text();
  }
  try {
    return await readFile(specFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Missing OpenAPI spec for SDK ${sdkVersion}. Run npm run schemas:snapshot -- --refresh to capture it.`);
  }
}

const raw = await readSpec();
export const spec = JSON.parse(raw);
if (spec.openapi !== '3.0.0') throw new Error(`Unexpected dialect: ${spec.openapi}`);
if (refresh) await writeFile(specFile, raw);

export const source = { url, sdkVersion, sha256: createHash('sha256').update(raw).digest('hex') };
