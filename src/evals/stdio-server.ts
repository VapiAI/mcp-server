#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { registerAllTools } from '../tools/index.js';

const fixtureUrl = process.env.MCP_EVAL_FIXTURE_URL;
if (!fixtureUrl) throw new Error('MCP_EVAL_FIXTURE_URL is required; model evaluation cannot use the production Vapi API.');
const fixture = new URL(fixtureUrl);
if (fixture.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(fixture.hostname)) {
  throw new Error('MCP_EVAL_FIXTURE_URL must point to a loopback HTTP fixture.');
}

const client = new VapiClient({ token: 'mcpjam-fixture-token', baseUrl: fixtureUrl, maxRetries: 0 });
const server = new McpServer({ name: 'Vapi MCP evaluation fixture', version: '0.0.0' });
registerAllTools(server, client);
await server.connect(new StdioServerTransport());

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
