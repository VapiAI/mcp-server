import { VapiClient, Vapi } from '@vapi-ai/server-sdk';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

export const vapiClientCommandContext = new AsyncLocalStorage<string>();
const vapiClientRunId = `local-${randomUUID()}`;

export const createVapiClient = (token: string): VapiClient => {
  if (!token) {
    throw new Error('No Vapi token available');
  }
  return new VapiClient({
    token,
    headers: {
      'x-vapi-client': () => {
        const command = vapiClientCommandContext.getStore();
        if (!command) return undefined;

        return `mcp/${packageMetadata.version}; command=${command}; run=${vapiClientRunId}`;
      },
    },
  });
};
