import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { GetToolInputSchema } from '../schemas/index.js';
import { transformToolOutput } from '../transformers/index.js';
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
};
