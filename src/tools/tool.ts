import { registerValidatedTool } from './validation.js';
import { creates, readOnly, updates } from './annotations.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { ListInputSchema, GetToolInputSchema, CreateToolInputSchema, UpdateToolInputSchema } from '../schemas/index.js';
import { transformToolInput, transformUpdateToolInput, transformToolOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { containsRedactionMarker } from '../utils/redact.js';
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
      description:
        'Creates a reusable capability a Vapi voice assistant can invoke during a conversation, such as a custom function, HTTP API request, SMS, or call transfer. ' +
        'Attach the returned tool ID to an assistant with create_assistant or update_assistant. ' +
        'For optional guidance on choosing a tool type, configuring it, and attaching it safely, load the public create-tool skill with load_skill({"name":"create-tool"}).',
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
      description:
        'Changes an existing reusable Vapi tool by toolId, such as its description, function endpoint, or transfer destinations. ' +
        'Inspect the tool with get_tool when preparing an edit. ' +
        'For optional guidance on safe configuration updates and assistant attachment management, load the public create-tool skill with load_skill({"name":"create-tool"}).',
      inputSchema: UpdateToolInputSchema,
      annotations: updates('Update Tool'),
    },
    createToolHandler(async (data) => {
      if (containsRedactionMarker(data)) {
        throw new Error('Redacted display values cannot be used in an update. Omit them or supply replacement credentials.');
      }
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
