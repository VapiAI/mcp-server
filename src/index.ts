#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { createVapiClient, type VapiToken } from './client.js';
import { resolveVapiToken, runLogin, runLogout, runStatus } from './auth/commands.js';

import dotenv from 'dotenv';
dotenv.config();

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

function createMcpServer(token: VapiToken | undefined = process.env.VAPI_TOKEN) {
  if (!token) {
    throw new Error('VAPI_TOKEN environment variable is required');
  }

  const vapiClient = createVapiClient(token);

  const mcpServer = new McpServer({
    name: 'Vapi MCP',
    version: packageMetadata.version,
  });

  registerAllTools(mcpServer, vapiClient);

  return mcpServer;
}

async function serve() {
  try {
    const mcpServer = createMcpServer(await resolveVapiToken());

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    setupShutdownHandler(mcpServer);
  } catch (err) {
    console.error('Failed to start MCP server:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const COMMANDS: Record<string, () => Promise<void>> = {
  login: runLogin,
  logout: runLogout,
  status: runStatus,
};

async function main() {
  // Anything other than a known command starts the server, as before.
  const command = COMMANDS[process.argv[2] ?? ''];
  if (!command) {
    return serve();
  }
  try {
    await command();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
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
