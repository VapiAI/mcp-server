import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { inputContract } from './assistant-openapi.js';

const snapshot = JSON.parse(readFileSync(new URL('./native-tool-openapi.json', import.meta.url), 'utf8'));
export function nativeToolField<T>(name: 'messages' | 'rejectionPlan'): z.ZodType<T> {
  const contract = JSON.parse(JSON.stringify(inputContract({
    ...snapshot.fields[name], definitions: snapshot.definitions,
  }), (key, value) => key === '$ref' && typeof value === 'string'
    ? value.replace('#/components/schemas/', '#/definitions/') : value));
  return z.fromJSONSchema(contract, { defaultTarget: 'openapi-3.0' }) as z.ZodType<T>;
}
