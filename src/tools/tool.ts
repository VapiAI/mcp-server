import { registerValidatedTool } from './validation.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { EmptyInputSchema, GetToolInputSchema, CreateToolInputSchema, UpdateToolInputSchema } from '../schemas/index.js';
import { transformToolInput, transformUpdateToolInput, transformToolOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';

export const registerToolTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  registerValidatedTool(
    server,
    'list_tools',
    {
      description: 'Lists all Vapi tools',
      inputSchema: EmptyInputSchema,
    },
    createToolHandler(async () => {
      const tools = await vapiClient.tools.list({ limit: 10 });
      return tools.map(transformToolOutput);
    })
  );

  registerValidatedTool(
    server,
    'get_tool',
    {
      description: 'Gets details of a specific tool',
      inputSchema: GetToolInputSchema,
    },
    createToolHandler(async (data) => {
      const tool = await vapiClient.tools.get({ id: data.toolId });
      return transformToolOutput(tool);
    })
  );

  registerValidatedTool(
    server,
    'create_tool',
    {
      description: 'Creates a new Vapi tool',
      inputSchema: CreateToolInputSchema,
    },
    createToolHandler(async (data) => {
      const createToolDto = transformToolInput(data);
      const tool = await vapiClient.tools.create(createToolDto);
      return transformToolOutput(tool);
    })
  );

  registerValidatedTool(
    server,
    'update_tool',
    {
      description: 'Updates an existing Vapi tool',
      inputSchema: UpdateToolInputSchema,
    },
    createToolHandler(async (data) => {
      const updateToolDto = transformUpdateToolInput(data);
      const tool = await vapiClient.tools.update({
        id: data.toolId,
        body: updateToolDto,
      });
      return transformToolOutput(tool);
    })
  );
};
