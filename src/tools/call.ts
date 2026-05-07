import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import {
  CallInputSchema,
  GetCallInputSchema,
  GetCallDetailsInputSchema,
} from '../schemas/index.js';
import {
  transformCallInput,
  transformCallOutput,
  transformCallDetailsOutput,
} from '../transformers/index.js';
import { createToolHandler } from './utils.js';

export const registerCallTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  server.tool(
    'list_calls',
    'Lists all Vapi calls',
    {},
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

  server.tool(
    'get_call_details',
    'Gets full details of a specific call (transcript, recording URL, messages, costs, analysis, summary, artifact). Use after get_call when summary fields are not enough. Pass `include` to scope the response and avoid blowing past LLM context windows on long calls.',
    GetCallDetailsInputSchema.shape,
    createToolHandler(async (data) => {
      const call = await vapiClient.calls.get(data.callId);
      return transformCallDetailsOutput(call, data.include);
    })
  );
};
