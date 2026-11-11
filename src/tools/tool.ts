import { registerValidatedTool } from './validation.js';
import { creates, readOnly, updates } from './annotations.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { ListInputSchema, GetToolInputSchema, CreateToolInputSchema, UpdateToolInputSchema } from '../schemas/index.js';
import { transformToolInput, transformUpdateToolInput, transformToolOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { createV1ListHandler } from './list.js';

export const registerToolTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  registerValidatedTool(
    server,
    'list_tools',
    {
      description: 'Lists up to 10 Vapi tools',
      inputSchema: ListInputSchema,
      annotations: readOnly('List Tools'),
    },
    createV1ListHandler(request => vapiClient.tools.list(request), transformToolOutput)
  );

  registerValidatedTool(
    server,
    'get_tool',
    {
      description: 'Gets details of a specific tool',
      inputSchema: GetToolInputSchema,
      annotations: readOnly('Get Tool'),
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
      annotations: creates('Create Tool'),
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
      annotations: updates('Update Tool'),
    },
    createToolHandler(async (data) => {
      const existingTool = await vapiClient.tools.get({ id: data.toolId });
      const updateToolDto = transformUpdateToolInput(data, existingTool);
      const tool = await vapiClient.tools.update({
        id: data.toolId,
        body: updateToolDto,
      });
      return transformToolOutput(tool);
    })
  );
};
