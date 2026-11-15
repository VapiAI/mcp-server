import { registerValidatedTool } from './validation.js';
import { creates, readOnly } from './annotations.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { ListInputSchema, CallInputSchema, GetCallInputSchema } from '../schemas/index.js';
import {
  transformCallInput,
  transformCallOutput,
} from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { createV1ListHandler } from './list.js';

export function uncertainCallError(error: unknown): Error {
  const uncertain = new Error(
    'Call creation outcome is unknown after one request. Check Vapi call history before retrying.',
    { cause: error }
  );
  if (error && typeof error === 'object') {
    Object.assign(uncertain, {
      statusCode: (error as { statusCode?: unknown }).statusCode,
      rawResponse: (error as { rawResponse?: unknown }).rawResponse,
    });
  }
  return uncertain;
}

export const registerCallTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  registerValidatedTool(
    server,
    'list_calls',
    {
      description: 'Lists up to 10 Vapi calls',
      inputSchema: ListInputSchema,
      annotations: readOnly('List Calls'),
    },
    createV1ListHandler(request => vapiClient.calls.list(request), transformCallOutput)
  );

  registerValidatedTool(
    server,
    'create_call',
    {
      description: 'Creates a outbound call',
      inputSchema: CallInputSchema,
      annotations: creates('Create Outbound Call', true),
    },
    createToolHandler(async (data) => {
      const createCallDto = transformCallInput(data);
      let call: Vapi.CreateCallsResponse;
      try {
        // Creating a call is non-idempotent. The SDK retries 408, 429, and 5xx
        // responses by default, which can create another call when the first
        // request was accepted but its response was lost.
        call = await vapiClient.calls.create(createCallDto, { maxRetries: 0 });
      } catch (error) {
        const statusCode = (error as { statusCode?: unknown })?.statusCode;
        if (typeof statusCode !== 'number' || statusCode === 408 || statusCode === 429 || statusCode >= 500) {
          // Preserve SDK metadata without exposing its potentially sensitive body.
          throw uncertainCallError(error);
        }
        throw error;
      }
      return transformCallOutput(call as unknown as Vapi.Call);
    })
  );

  registerValidatedTool(
    server,
    'get_call',
    {
      description: 'Gets details of a specific call',
      inputSchema: GetCallInputSchema,
      annotations: readOnly('Get Call'),
    },
    createToolHandler(async (data) => {
      const call = await vapiClient.calls.get({ id: data.callId });
      return transformCallOutput(call);
    })
  );
};
