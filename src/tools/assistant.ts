import { registerValidatedTool } from './validation.js';
import { creates, readOnly, updates } from './annotations.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';
import {
  ListInputSchema,
  CreateAssistantInputSchema,
  GetAssistantInputSchema,
  UpdateAssistantInputSchema,
} from '../schemas/index.js';
import {
  transformAssistantInput,
  transformAssistantOutput,
  transformUpdateAssistantInput,
} from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { createV1ListHandler } from './list.js';
import { vapiRequestOptions } from './execution.js';

export const registerAssistantTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  registerValidatedTool(
    server,
    'list_assistants',
    {
      description: 'Lists up to 10 Vapi assistants',
      inputSchema: ListInputSchema,
      annotations: readOnly('List Assistants'),
    },
    createV1ListHandler((request, { signal }) => vapiClient.assistants.list(request, vapiRequestOptions(signal)), transformAssistantOutput)
  );

  registerValidatedTool(
    server,
    'create_assistant',
    {
      description:
        'Creates a saved Vapi voice agent configuration: its instructions, language model, voice, transcription settings, opening message, and callable tools. ' +
        'Reuse the returned assistant ID with create_call to start conversations. ' +
        'For optional guidance on designing the agent and planning its configuration, load the public create-assistant skill with load_skill({"name":"create-assistant"}).',
      inputSchema: CreateAssistantInputSchema,
      annotations: creates('Create Assistant'),
    },
    createToolHandler(async (data, { signal }) => {
      //   console.log('create_assistant', data);
      const createAssistantDto = transformAssistantInput(data);
      const assistant = await vapiClient.assistants.create(createAssistantDto, vapiRequestOptions(signal));
      return transformAssistantOutput(assistant);
    })
  );

  registerValidatedTool(
    server,
    'get_assistant',
    {
      description: 'Gets a Vapi assistant by ID',
      inputSchema: GetAssistantInputSchema,
      annotations: readOnly('Get Assistant'),
    },
    createToolHandler(async (data, { signal }) => {
      //   console.log('get_assistant', data);
      const assistantId = data.assistantId;
      try {
        const assistant = await vapiClient.assistants.get({ id: assistantId }, vapiRequestOptions(signal));
        if (!assistant) {
          throw new Error(`Assistant with ID ${assistantId} not found`);
        }
        return transformAssistantOutput(assistant);
      } catch (error: any) {
        console.error(`Error getting assistant: ${error.message}`);
        throw error;
      }
    })
  );

  registerValidatedTool(
    server,
    'update_assistant',
    {
      description:
        'Updates a saved Vapi voice agent\'s instructions, language model, voice, transcription settings, opening message, or attached tool IDs. ' +
        'Use this to refine an existing agent\'s configuration for future calls. ' +
        'For optional guidance on agent design, provider choices, and configuration, load the public create-assistant skill with load_skill({"name":"create-assistant"}).',
      inputSchema: UpdateAssistantInputSchema,
      annotations: updates('Update Assistant'),
    },
    createToolHandler(async (data, { signal }) => {
      const assistantId = data.assistantId;
      try {
        // First check if the assistant exists
        const existingAssistant = await vapiClient.assistants.get({
          id: assistantId,
        }, vapiRequestOptions(signal));
        if (!existingAssistant) {
          throw new Error(`Assistant with ID ${assistantId} not found`);
        }

        // Transform the update data
        const updateAssistantDto = transformUpdateAssistantInput(
          data,
          existingAssistant
        );

        // Update the assistant
        const updatedAssistant = await vapiClient.assistants.update({
          ...updateAssistantDto,
          id: assistantId,
        }, vapiRequestOptions(signal));

        return transformAssistantOutput(updatedAssistant);
      } catch (error: any) {
        console.error(`Error updating assistant: ${error.message}`);
        throw error;
      }
    })
  );
};
