import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { GetToolInputSchema, CreateToolInputSchema, UpdateToolInputSchema } from '../schemas/index.js';
import { transformToolInput, transformUpdateToolInput, transformToolOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';

export const registerToolTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  server.registerTool(
    'list_tools',
    {
      description: 'Lists all Vapi tools',
      inputSchema: {},
    },
    createToolHandler(async () => {
      const tools = await vapiClient.tools.list({ limit: 10 });
      return tools.map(transformToolOutput);
    })
  );

  server.registerTool(
    'get_tool',
    { description: 'Gets details of a specific tool', inputSchema: GetToolInputSchema.shape },
    createToolHandler(async (data) => {
      const tool = await vapiClient.tools.get(data.toolId);
      return transformToolOutput(tool);
    })
  );

  server.registerTool(
    'create_tool',
    { description: 'Creates a new Vapi tool', inputSchema: CreateToolInputSchema.shape },
    createToolHandler(async (data) => {
      const createToolDto = transformToolInput(data);
      const tool = await vapiClient.tools.create(createToolDto);
      return transformToolOutput(tool);
    })
  );

  server.registerTool(
    'update_tool',
    { description: 'Updates an existing Vapi tool', inputSchema: UpdateToolInputSchema.shape },
    createToolHandler(async (data) => {
      const updateToolDto = transformUpdateToolInput(data);
      const tool = await vapiClient.tools.update(data.toolId, updateToolDto);
      return transformToolOutput(tool);
    })
  );
};
