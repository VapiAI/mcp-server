import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { GetToolInputSchema, CreateToolInputSchema } from '../schemas/index.js';
import { transformToolInput, transformToolOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';

export const registerToolTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  server.tool(
    'list_tools',
    'Lists all Vapi tools',
    {},
    createToolHandler(async () => {
      const tools = await vapiClient.tools.list({ limit: 10 });
      return tools.map(transformToolOutput);
    })
  );

  server.tool(
    'get_tool',
    'Gets details of a specific tool',
    GetToolInputSchema.shape,
    createToolHandler(async (data) => {
      const tool = await vapiClient.tools.get(data.toolId);
      return transformToolOutput(tool);
    })
  );

  server.tool(
    'create_tool',
    'Creates a new Vapi tool',
    CreateToolInputSchema.shape,
    createToolHandler(async (data) => {
      const createToolDto = transformToolInput(data);
      const tool = await vapiClient.tools.create(createToolDto);
      return transformToolOutput(tool);
    })
  );
};
