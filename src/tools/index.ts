import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';

import { registerAssistantTools } from './assistant.js';
import { registerCallTools } from './call.js';
import { registerPhoneNumberTools } from './phone-number.js';
import { registerToolTools } from './tool.js';

export const registerAllTools = (server: McpServer, vapiClient: VapiClient) => {
  registerAssistantTools(server, vapiClient);
  registerCallTools(server, vapiClient);
  registerPhoneNumberTools(server, vapiClient);
  registerToolTools(server, vapiClient);
};
