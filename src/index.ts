#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { hasValidToken, getToken, startAuthFlow, isAuthInProgress, getAuthUrl, clearConfig } from './auth.js';
import { registerAllTools } from './tools/index.js';

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lazy-initialized Vapi client
let vapiClient: VapiClient | null = null;

function getVapiClient(): VapiClient {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  // Reset client if token changed
  if (!vapiClient) {
    vapiClient = new VapiClient({ token });
  }
  return vapiClient;
}

function createMcpServer() {
  const mcpServer = new McpServer({
    name: 'Vapi MCP',
    version: '0.1.0',
    capabilities: [],
  });

  // Register the login tool - always available
  mcpServer.tool(
    'vapi_login',
    'Authenticate with Vapi. Call this first if other tools return authentication errors.',
    {},
    async () => {
      // Check if we have a token and validate it
      if (hasValidToken()) {
        try {
          const client = getVapiClient();
          await client.assistants.list({ limit: 1 });
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Already authenticated with Vapi! You can now use other Vapi tools.',
              },
            ],
          };
        } catch {
          // Token is stale — clear it and restart auth
          clearConfig();
          vapiClient = null;
        }
      }

      // Check if auth is already in progress
      if (isAuthInProgress()) {
        const url = getAuthUrl();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Authentication in progress. Please complete sign-in:\n\n${url}\n\nAfter signing in, try your request again.`,
            },
          ],
        };
      }

      // Start auth flow
      try {
        const authUrl = await startAuthFlow();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Please sign in to Vapi:\n\n${authUrl}\n\nAfter signing in, try your request again.`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to start authentication: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register logout tool
  mcpServer.tool(
    'vapi_logout',
    'Log out of Vapi and clear stored credentials. Use this if your auth token is stale or you want to switch accounts.',
    {},
    async () => {
      clearConfig();
      vapiClient = null;
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Logged out of Vapi. Use vapi_login to sign in again.',
          },
        ],
      };
    }
  );

  // Register all Vapi tools - they will check auth via createToolHandler
  // We use a proxy that creates the client lazily
  const clientProxy = new Proxy({} as VapiClient, {
    get(_, prop) {
      return getVapiClient()[prop as keyof VapiClient];
    },
  });

  registerAllTools(mcpServer, clientProxy);

  // Expose the prompt guide as an MCP resource
  mcpServer.resource(
    'prompt-guide',
    'vapi://prompt-guide',
    { description: 'Voice assistant prompt engineering guide with best practices for crafting Vapi assistant prompts', mimeType: 'text/markdown' },
    async (uri) => {
      const guidePath = join(__dirname, '..', 'skills', 'vapi', 'PROMPT_GUIDE.md');
      const content = readFileSync(guidePath, 'utf-8');
      return {
        contents: [{ uri: uri.href, text: content }],
      };
    }
  );

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
