import { registerValidatedTool } from './validation.js';
import { creates, readOnly } from './annotations.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { ListCallsInputSchema, CallInputSchema, GetCallInputSchema } from '../schemas/index.js';
import {
  transformCallInput,
  transformCallOutput,
} from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { createV1ListHandler } from './list.js';

export const registerCallTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  registerValidatedTool(
    server,
    'list_calls',
    {
      description: 'Lists Vapi calls with ID and date filters, newest first (default 10, maximum 100 per page)',
      inputSchema: ListCallsInputSchema,
      annotations: readOnly('List Calls'),
    },
    createV1ListHandler((request: Vapi.ListCallsRequest) => vapiClient.calls.list(request), transformCallOutput)
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
      const call = await vapiClient.calls.create(createCallDto);
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
