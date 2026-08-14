import { randomUUID } from 'node:crypto';
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
  let client: Client | undefined;

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
    await client?.close();
  });

  async function invoke(name: string, args: Record<string, unknown>) {
    const response = await client!.callTool({ name, arguments: args });
    const parsed = parseToolResponse(response);
    if (parsed?.error) {
      const diagnostic = safeDiagnostic(parsed.error);
      throw new Error(`Live Vapi operation failed: ${name}: ${diagnostic}`);
    }
    return parsed;
  }

  function safeDiagnostic(error: unknown): string {
    const diagnostic =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const token = process.env.VAPI_TOKEN;
    return token ? diagnostic.replaceAll(token, '[REDACTED]') : diagnostic;
  }

  test('creates, retrieves, updates, and deletes disposable resources', async () => {
    const marker = `mcpcompat${Date.now().toString(36)}${randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    const createdAssistantName = `${marker}-a-created`;
    const updatedAssistantName = `${marker}-a-updated`;
    const createdToolName = `${marker}_t_created`;
    const updatedToolName = `${marker}_t_updated`;
    const expectedAssistantNames = new Set([
      createdAssistantName,
      updatedAssistantName,
    ]);
    const expectedToolNames = new Set([createdToolName, updatedToolName]);
    const discoveryWindowStart = new Date(
      Date.now() - 5 * 60 * 1000
    ).toISOString();
    const cleanupClient = createVapiClient(process.env.VAPI_TOKEN!);
    let assistantId: string | undefined;
    let toolId: string | undefined;
    let testFailure: unknown;

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
    } catch (error) {
      testFailure = error;
      throw error;
    } finally {
      const assistantIds = new Set<string>();
      const toolIds = new Set<string>();
      const cleanupErrors: unknown[] = [];

      if (assistantId) assistantIds.add(assistantId);
      if (toolId) toolIds.add(toolId);

      // A create request can succeed remotely even if its response cannot be
      // parsed or assigned. Discover only resources with this run's exact,
      // unique names so cleanup cannot affect unrelated organization data.
      const discoveryResults = await Promise.allSettled([
        Promise.resolve().then(() =>
          cleanupClient.assistants.list({
            limit: 100,
            createdAtGe: discoveryWindowStart,
          })
        ),
        Promise.resolve().then(() =>
          cleanupClient.tools.list({
            limit: 100,
            createdAtGe: discoveryWindowStart,
          })
        ),
      ]);

      const [assistantsResult, toolsResult] = discoveryResults;
      if (assistantsResult.status === 'fulfilled') {
        for (const assistant of assistantsResult.value) {
          if (
            assistant.id &&
            assistant.name &&
            expectedAssistantNames.has(assistant.name)
          ) {
            assistantIds.add(assistant.id);
          }
        }
      } else {
        cleanupErrors.push(assistantsResult.reason);
      }

      if (toolsResult.status === 'fulfilled') {
        for (const tool of toolsResult.value) {
          const name = tool.function?.name;
          if (tool.id && name && expectedToolNames.has(name)) {
            toolIds.add(tool.id);
          }
        }
      } else {
        cleanupErrors.push(toolsResult.reason);
      }

      const cleanupOperations = [
        ...Array.from(toolIds, async (id) => cleanupClient.tools.delete(id)),
        ...Array.from(assistantIds, async (id) =>
          cleanupClient.assistants.delete(id)
        ),
      ];
      const cleanupResults = await Promise.allSettled(cleanupOperations);
      cleanupErrors.push(
        ...cleanupResults
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected'
          )
          .map((result) => result.reason)
      );

      if (cleanupErrors.length > 0) {
        const recoveryMessage =
          `Cleanup incomplete for disposable Vapi live-test resources. ` +
          `Recovery marker: ${marker}. Search only for assistant names ` +
          `${[...expectedAssistantNames].join(', ')} and tool function names ` +
          `${[...expectedToolNames].join(', ')}. Cleanup diagnostics: ` +
          cleanupErrors.map(safeDiagnostic).join(' | ');

        if (testFailure !== undefined) {
          console.error(recoveryMessage);
        } else {
          throw new AggregateError(
            cleanupErrors.map((error) => new Error(safeDiagnostic(error))),
            recoveryMessage
          );
        }
      }
    }
  });
});
