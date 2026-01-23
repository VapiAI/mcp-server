import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';
import { createVapiClient } from '../client.js';
import { getApiKeyOrTriggerOAuth } from '../auth/oauth.js';

import { registerAssistantTools } from './assistant.js';
import { registerCallTools } from './call.js';
import { registerPhoneNumberTools } from './phone-number.js';
import { registerToolTools } from './tool.js';

export const registerAllTools = (server: McpServer, vapiClient: VapiClient | null) => {
  // If client is not provided, create a lazy client that triggers OAuth on first use
  let lazyClient: VapiClient | null = vapiClient;

  const getClient = (): VapiClient => {
    if (!lazyClient) {
      // Trigger OAuth flow or get stored credentials
      const apiKey = getApiKeyOrTriggerOAuth();
      lazyClient = createVapiClient(apiKey);
    }
    return lazyClient;
  };

  // Register tools with lazy client initialization
  registerAssistantTools(server, getClient);
  registerCallTools(server, getClient);
  registerPhoneNumberTools(server, getClient);
  registerToolTools(server, getClient);
};
