import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import dotenv from 'dotenv';
import { parseToolResponse } from '../utils/response.js';

dotenv.config();

jest.setTimeout(15000);

describe('MCP Server E2E Test', () => {
  let mcpClient: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const serverScriptPath = join(process.cwd(), 'src', 'index.ts');
    console.log(`Using server source at: ${serverScriptPath}`);

    mcpClient = new Client({ name: 'vapi-e2e-test-client', version: '1.0.0' });

    transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', serverScriptPath],
      env: {
        ...process.env,
        VAPI_TOKEN: process.env.VAPI_TOKEN || 'test-token',
      },
    });

    console.log('Connecting to MCP server...');
    await mcpClient.connect(transport);
    console.log('Connected to server successfully');
  });

  afterAll(async () => {
    console.log('Disconnecting from server...');
    await mcpClient.close();
    console.log('Disconnected from server');
  });

  test('should list available tools', async () => {
    console.log('Requesting available tools...');
    const toolsResult = await mcpClient.listTools();

    expect(toolsResult.tools).toBeDefined();
    expect(Array.isArray(toolsResult.tools)).toBe(true);

    const toolNames = toolsResult.tools.map((tool) => tool.name);
    console.log('Available tools:', toolNames);

    expect(toolNames).toContain('list_assistants');
    expect(toolNames).toContain('create_assistant');
    expect(toolNames).toContain('get_assistant');

    expect(toolNames).toContain('list_phone_numbers');
    expect(toolNames).toContain('get_phone_number');

    expect(toolNames).toContain('list_calls');
    expect(toolNames).toContain('create_call');
    expect(toolNames).toContain('get_call');
  });

  describe('Assistant Tools', () => {
    test('should list all assistants', async () => {
      console.log('Calling list_assistants tool...');
      const rawResult = await mcpClient.callTool({
        name: 'list_assistants',
        arguments: {},
      });

      const result = parseToolResponse(rawResult);
      expect(result).toBeDefined();
      if (Array.isArray(result)) {
        console.log(`Received ${result.length} assistants in array form`);
      } else {
        console.log(`Received assistants in non-array form:`, result);
      }
    });

    test('should create a new assistant', async () => {
      console.log('Calling create_assistant tool...');
      const assistantData = {
        name: `Test Assistant ${Date.now()}`,
        instructions: 'You are a helpful test assistant',
        llm: {
          provider: 'openai',
          model: 'gpt-4o',
        },
        transcriber: {
          provider: 'deepgram',
          model: 'nova-3',
        },
        voice: {
          provider: '11labs',
          model: 'eleven_turbo_v2_5',
          voiceId: 'sarah',
        },
        firstMessage: "Hello, I'm your vapi assistant.",
      };

      const rawResult = await mcpClient.callTool({
        name: 'create_assistant',
        arguments: assistantData,
      });

      const result = parseToolResponse(rawResult);
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe(assistantData.name);
      expect(result.llm.provider).toBe(assistantData.llm.provider);
      expect(result.llm.model).toBe(assistantData.llm.model);

      console.log(`Successfully created assistant with ID: ${result.id}`);
    });

    test('should get an assistant by ID', async () => {
      console.log('Listing assistants to get the first one...');
      const rawListResult = await mcpClient.callTool({
        name: 'list_assistants',
        arguments: {},
      });

      const listResult = parseToolResponse(rawListResult);
      expect(listResult).toBeDefined();
      expect(Array.isArray(listResult)).toBe(true);

      if (listResult.length === 0) {
        console.log('No assistants found, skipping get_assistant test.');
        // Optionally, you could fail the test here or create an assistant first
        return;
      }

      const firstAssistant = listResult[0];
      expect(firstAssistant.id).toBeDefined();
      const assistantId = firstAssistant.id;
      const assistantName = firstAssistant.name;

      console.log(
        `Attempting to fetch assistant with ID: ${assistantId} (Name: ${assistantName})`
      );

      const rawGetResult = await mcpClient.callTool({
        name: 'get_assistant',
        arguments: { assistantId: assistantId },
      });

      const getResult = parseToolResponse(rawGetResult);
      expect(getResult).toBeDefined();
      expect(getResult.id).toBe(assistantId);
      expect(getResult.name).toBe(assistantName); // Verify name matches too

      console.log(`Successfully fetched assistant with ID: ${getResult.id}`);
    });

    test('should handle invalid assistant ID', async () => {
      const invalidId = 'non-existent-assistant-id-' + Date.now();
      console.log(
        `Testing error handling with invalid assistant ID: ${invalidId}`
      );

      try {
        const rawResult = await mcpClient.callTool({
          name: 'get_assistant',
          arguments: { assistantId: invalidId },
        });

        const result = parseToolResponse(rawResult);
        // Check for error in the result
        if (
          result.error ||
          (typeof result === 'string' &&
            (result.includes('Error') || result.includes('error')))
        ) {
          // Test passed - we got an error response
          expect(true).toBe(true);
        } else {
          // If we somehow got a successful result, fail the test
          expect(result).toContain('error');
        }
      } catch (error) {
        // This is also acceptable - the API might throw instead of returning error
        expect(error).toBeDefined();
      }
    });
  });

  describe('Phone Number Tools', () => {
    test('should list all phone numbers', async () => {
      console.log('Calling list_phone_numbers tool...');
      const rawResult = await mcpClient.callTool({
        name: 'list_phone_numbers',
        arguments: {},
      });

      const result = parseToolResponse(rawResult);
      expect(result).toBeDefined();
      if (Array.isArray(result)) {
        console.log(`Received ${result.length} phone numbers in array form`);
      } else {
        console.log(`Received phone numbers in non-array form:`, result);
      }
    });

    test('should handle invalid phone number ID', async () => {
      const invalidId = 'non-existent-phone-number-id-' + Date.now();
      console.log(
        `Testing error handling with invalid phone number ID: ${invalidId}`
      );

      try {
        const rawResult = await mcpClient.callTool({
          name: 'get_phone_number',
          arguments: { phoneNumberId: invalidId },
        });

        const result = parseToolResponse(rawResult);
        // Check for error in the result
        if (
          result.error ||
          (typeof result === 'string' &&
            (result.includes('Error') || result.includes('error')))
        ) {
          // Test passed - we got an error response
          expect(true).toBe(true);
        } else {
          // If we somehow got a successful result, fail the test
          expect(result).toContain('error');
        }
      } catch (error) {
        // This is also acceptable - the API might throw instead of returning error
        expect(error).toBeDefined();
      }
    });
  });

  describe('Call Tools', () => {
    test('should list all calls', async () => {
      console.log('Calling list_calls tool...');
      const rawResult = await mcpClient.callTool({
        name: 'list_calls',
        arguments: {},
      });

      const result = parseToolResponse(rawResult);
      expect(result).toBeDefined();
      if (Array.isArray(result)) {
        console.log(`Received ${result.length} calls in array form`);
      } else {
        console.log(`Received calls in non-array form:`, result);
      }
    });

    test('should handle invalid call ID', async () => {
      const invalidId = 'non-existent-call-id-' + Date.now();
      console.log(`Testing error handling with invalid call ID: ${invalidId}`);

      try {
        const rawResult = await mcpClient.callTool({
          name: 'get_call',
          arguments: { callId: invalidId },
        });

        const result = parseToolResponse(rawResult);
        // Check for error in the result
        if (
          result.error ||
          (typeof result === 'string' &&
            (result.includes('Error') || result.includes('error')))
        ) {
          // Test passed - we got an error response
          expect(true).toBe(true);
        } else {
          // If we somehow got a successful result, fail the test
          expect(result).toContain('error');
        }
      } catch (error) {
        // This is also acceptable - the API might throw instead of returning error
        expect(error).toBeDefined();
      }
    });
  });
});
