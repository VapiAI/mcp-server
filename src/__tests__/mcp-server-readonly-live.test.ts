import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import dotenv from 'dotenv';
import { parseToolResponse } from '../utils/response.js';

dotenv.config();
jest.setTimeout(30_000);

const liveDescribe =
  process.env.RUN_VAPI_READONLY_TESTS === '1' ? describe : describe.skip;

liveDescribe('live Vapi read-only compatibility', () => {
  let client: Client;

  beforeAll(async () => {
    if (!process.env.VAPI_TOKEN) {
      throw new Error('VAPI_TOKEN is required for read-only live tests');
    }

    client = new Client({
      name: 'vapi-readonly-compat-client',
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

  async function invoke(name: string, args: Record<string, unknown> = {}) {
    const response = await client.callTool({ name, arguments: args });
    const parsed = parseToolResponse(response);
    if (parsed?.error) {
      throw new Error(`Read-only Vapi operation failed: ${name}`);
    }
    return parsed;
  }

  test('initializes, pings, and exposes the complete tool catalog', async () => {
    await expect(client.ping()).resolves.toBeDefined();
    expect(client.getServerVersion()).toEqual(
      expect.objectContaining({ name: 'Vapi MCP', version: '0.1.0' })
    );
    expect(client.getServerCapabilities()).toEqual(
      expect.objectContaining({ tools: expect.any(Object) })
    );

    const catalog = await client.listTools();
    expect(catalog.tools).toHaveLength(13);
  });

  test.each([
    'list_assistants',
    'list_calls',
    'list_phone_numbers',
    'list_tools',
  ])('%s succeeds without exposing response data', async (name) => {
    const result = await invoke(name);
    expect(Array.isArray(result)).toBe(true);
  });

  test.each([
    ['list_assistants', 'get_assistant', 'assistantId'],
    ['list_calls', 'get_call', 'callId'],
    ['list_phone_numbers', 'get_phone_number', 'phoneNumberId'],
    ['list_tools', 'get_tool', 'toolId'],
  ])(
    '%s results can be retrieved through %s when present',
    async (listName, getName, idArgument) => {
      const listed = await invoke(listName);
      if (listed.length === 0) return;

      expect(typeof listed[0].id).toBe('string');
      const retrieved = await invoke(getName, {
        [idArgument]: listed[0].id,
      });
      expect(typeof retrieved.id).toBe('string');
    }
  );
});
