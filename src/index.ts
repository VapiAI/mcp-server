#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { createVapiClient } from './client.js';

import dotenv from 'dotenv';
dotenv.config();

function createMcpServer() {
  const vapiToken = process.env.VAPI_TOKEN;
  if (!vapiToken) {
    throw new Error('VAPI_TOKEN environment variable is required');
  }

  const vapiClient = createVapiClient(vapiToken);

  const mcpServer = new McpServer({
    name: 'Vapi MCP',
    version: '0.1.0',
    capabilities: [],
  });

  registerAllTools(mcpServer, vapiClient);

  return mcpServer;
}

async function main() {
  try {
    const mcpServer = createMcpServer();

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    setupShutdownHandler(mcpServer);
  } catch (err) {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  }
}

function setupShutdownHandler(mcpServer: McpServer) {
  process.on('SIGINT', async () => {
    try {
      await mcpServer.close();
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

export { createMcpServer };
