import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { CallInputSchema, GetCallInputSchema } from '../schemas/index.js';
import {
  transformCallInput,
  transformCallOutput,
} from '../transformers/index.js';
import { createToolHandler } from './utils.js';

export const registerCallTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  server.registerTool(
    'list_calls',
    {
      description: 'Lists all Vapi calls',
      inputSchema: {},
    },
    createToolHandler(async () => {
      const calls = await vapiClient.calls.list({ limit: 10 });
      return calls.map(transformCallOutput);
    })
  );

  server.tool(
    'create_call',
    'Creates a outbound call',
    CallInputSchema.shape,
    createToolHandler(async (data) => {
      const createCallDto = transformCallInput(data);
      const call = await vapiClient.calls.create(createCallDto);
      return transformCallOutput(call as unknown as Vapi.Call);
    })
  );

  server.tool(
    'get_call',
    'Gets details of a specific call',
    GetCallInputSchema.shape,
    createToolHandler(async (data) => {
      const call = await vapiClient.calls.get(data.callId);
      return transformCallOutput(call);
    })
  );
};
