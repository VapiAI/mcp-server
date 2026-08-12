import { beforeAll, describe, expect, jest, test } from '@jest/globals';
import { createMcpServer } from '../index.js';
import { createMockVapiClient } from './mocks/vapi-client.mock.js';

jest.mock('../client.js', () => ({
  createVapiClient: jest.fn(() => createMockVapiClient()),
}));

process.env.VAPI_TOKEN = 'test-mock-token';

describe('MCP Server Unit Test (with mocks)', () => {
  let mcpServer: any;

  beforeAll(() => {
    console.log('Creating MCP server with mocked Vapi client...');
    mcpServer = createMcpServer();
    console.log('MCP server created successfully');
  });

  test('server should be initialized correctly', () => {
    expect(mcpServer).toBeDefined();
    expect(typeof mcpServer).toBe('object');
    expect(mcpServer.constructor.name).toBe('McpServer');

    expect(mcpServer.connect).toBeDefined();
    expect(typeof mcpServer.connect).toBe('function');
  });

  test('server should have required internal structures', () => {
    expect(mcpServer._registeredTools).toBeDefined();
    expect(typeof mcpServer._registeredTools).toBe('object');
  });

  test('server should have registered Vapi tools', () => {
    const registeredTools = Object.keys(mcpServer._registeredTools);
    expect(registeredTools.length).toBeGreaterThan(0);

    console.log('Found registered tools:', registeredTools);

    expect(registeredTools).toContain('list_assistants');
    expect(registeredTools).toContain('create_assistant');
    expect(registeredTools).toContain('get_assistant');
  });
});
