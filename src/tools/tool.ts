import { validateToolUpdate, toolCreateInputContract, toolUpdateInputContract } from '../schemas/tool-openapi.js';
import { registerValidatedTool } from './validation.js';
import { creates, readOnly, updates } from './annotations.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import { ListInputSchema, GetToolInputSchema, CreateToolInputSchema, UpdateToolInputSchema } from '../schemas/index.js';
import { transformToolInput, transformUpdateToolInput, transformToolOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { containsRedactionMarker } from '../utils/credential-redaction.js';
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
        'Creates a reusable capability a Vapi voice assistant can invoke during a conversation to act on external systems or change the state of a call. ' +
        'Pass API fields directly, without MCP wrappers or additionalFields. For optional detailed documentation and worked examples, use get_api_schema({"tool":"create_tool"}) and request a returned schema name. Attach the returned tool ID to an assistant with create_assistant or update_assistant. ' +
        'For optional guidance on choosing a tool type, configuring it, and attaching it safely, load the public create-tool skill with load_skill({"name":"create-tool"}).',
      inputSchema: CreateToolInputSchema,
      advertisedInputSchema: toolCreateInputContract,
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
        'Changes an existing reusable Vapi tool by id to configure actions on external systems or changes to call state. ' +
        'Inspect the tool with get_tool when preparing an edit. Pass id plus API update fields directly. Type, if given, must match the existing tool. Optional detailed documentation is available with get_api_schema({"tool":"update_tool"}). ' +
        'For optional guidance on safe configuration updates and assistant attachment management, load the public create-tool skill with load_skill({"name":"create-tool"}).',
      inputSchema: UpdateToolInputSchema,
      advertisedInputSchema: toolUpdateInputContract,
      annotations: updates('Update Tool'),
    },
    createToolHandler(async (data) => {
      const existingTool = await vapiClient.tools.get({ id: data.id });
      const body = transformUpdateToolInput(data, existingTool);
      if (containsRedactionMarker(body)) {
        throw new Error('Redacted display values cannot be used in an update. Supply replacement credentials for those values.');
      }
      const updateToolDto = validateToolUpdate(existingTool.type, body);
      const tool = await vapiClient.tools.update({
        id: data.id,
        body: updateToolDto as unknown as Vapi.UpdateToolsRequestBody,
      });
      return transformToolOutput(tool);
    })
  );
};
