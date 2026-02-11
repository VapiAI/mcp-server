#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { VapiDocsServer } from './server.js';

async function main() {
  // Create the Vapi MCP docs server
  const server = new Server(
    {
      name: 'vapi-docs-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Initialize the Vapi docs handler
  const vapiDocs = new VapiDocsServer();

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: vapiDocs.getTools(),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await vapiDocs.callTool(name, args || {});
  });

  // Handle list resources request
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: vapiDocs.getResources(),
    };
  });

  // Handle read resource request
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    return await vapiDocs.readResource(uri);
  });

  // Set up stdio transport
  const transport = new StdioServerTransport();

  // Start the server
  await server.connect(transport);

  // Log server start (only visible in debug mode)
  if (process.env.DEBUG) {
    console.error('Vapi MCP Docs Server started successfully');
  }
}

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  if (process.env.DEBUG) {
    console.error('Uncaught exception:', error);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (process.env.DEBUG) {
    console.error('Unhandled rejection:', reason);
  }
  process.exit(1);
});

// Start the server
main().catch((error) => {
  if (process.env.DEBUG) {
    console.error('Failed to start server:', error);
  }
  process.exit(1);
});
