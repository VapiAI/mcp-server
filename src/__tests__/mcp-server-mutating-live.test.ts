import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import dotenv from 'dotenv';
import { createVapiClient } from '../client.js';
import { parseToolResponse } from '../utils/response.js';

dotenv.config();
jest.setTimeout(60_000);

const liveDescribe =
  process.env.RUN_VAPI_MUTATING_TESTS === '1' ? describe : describe.skip;

liveDescribe('live Vapi create/update compatibility', () => {
  let client: Client;

  beforeAll(async () => {
    if (!process.env.VAPI_TOKEN) {
      throw new Error('VAPI_TOKEN is required for mutating live tests');
    }

    client = new Client({
      name: 'vapi-mutating-compat-client',
      version: '1.0.0',
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), 'dist', 'index.js')],
      env: {
        ...process.env,
        VAPI_TOKEN: process.env.VAPI_TOKEN,
      },
    });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  async function invoke(name: string, args: Record<string, unknown>) {
    const response = await client.callTool({ name, arguments: args });
    const parsed = parseToolResponse(response);
    if (parsed?.error) {
      const diagnostic = String(parsed.error).replaceAll(
        process.env.VAPI_TOKEN ?? '',
        '[REDACTED]'
      );
      throw new Error(`Live Vapi operation failed: ${name}: ${diagnostic}`);
    }
    return parsed;
  }

  test('creates, retrieves, updates, and deletes disposable resources', async () => {
    const marker = `mcpcompat${Date.now().toString(36)}`;
    const createdAssistantName = `${marker}-a-created`;
    const updatedAssistantName = `${marker}-a-updated`;
    const createdToolName = `${marker}_t_created`;
    const updatedToolName = `${marker}_t_updated`;
    const cleanupClient = createVapiClient(process.env.VAPI_TOKEN!);
    let assistantId: string | undefined;
    let toolId: string | undefined;

    try {
      const createdAssistant = await invoke('create_assistant', {
        name: createdAssistantName,
      });
      assistantId = createdAssistant.id;
      expect(typeof assistantId).toBe('string');
      expect(createdAssistant.name).toBe(createdAssistantName);

      const retrievedAssistant = await invoke('get_assistant', {
        assistantId,
      });
      expect(retrievedAssistant.id).toBe(assistantId);
      expect(retrievedAssistant.name).toBe(createdAssistantName);

      const updatedAssistant = await invoke('update_assistant', {
        assistantId,
        name: updatedAssistantName,
      });
      expect(updatedAssistant.id).toBe(assistantId);
      expect(updatedAssistant.name).toBe(updatedAssistantName);

      const persistedAssistant = await invoke('get_assistant', {
        assistantId,
      });
      expect(persistedAssistant.name).toBe(updatedAssistantName);

      const createdTool = await invoke('create_tool', {
        type: 'apiRequest',
        name: createdToolName,
        description: 'Disposable compatibility test tool',
        apiRequest: {
          url: 'https://example.com/',
          method: 'GET',
        },
      });
      toolId = createdTool.id;
      expect(typeof toolId).toBe('string');
      expect(createdTool.name).toBe(createdToolName);

      const retrievedTool = await invoke('get_tool', { toolId });
      expect(retrievedTool.id).toBe(toolId);
      expect(retrievedTool.name).toBe(createdToolName);

      const updatedTool = await invoke('update_tool', {
        toolId,
        name: updatedToolName,
        description: 'Updated disposable compatibility test tool',
      });
      expect(updatedTool.id).toBe(toolId);
      expect(updatedTool.name).toBe(updatedToolName);

      const persistedTool = await invoke('get_tool', { toolId });
      expect(persistedTool.name).toBe(updatedToolName);
    } finally {
      if (toolId) {
        await cleanupClient.tools.delete(toolId);
      }
      if (assistantId) {
        await cleanupClient.assistants.delete(assistantId);
      }
    }
  });
});
