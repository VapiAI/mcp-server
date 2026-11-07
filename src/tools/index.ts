import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';

import { registerDocsTools } from './docs.js';
import { registerAssistantTools } from './assistant.js';
import { registerCallTools } from './call.js';
import { registerPhoneNumberTools } from './phone-number.js';
import { registerSimulationTools } from './simulation.js';
import { registerToolTools } from './tool.js';
import { registerSkillTools } from './skills.js';
import { registerApiSchemaTools } from './api-schema.js';

export const registerAllTools = (server: McpServer, vapiClient: VapiClient) => {
  registerDocsTools(server);
  registerAssistantTools(server, vapiClient);
  registerCallTools(server, vapiClient);
  registerPhoneNumberTools(server, vapiClient);
  registerToolTools(server, vapiClient);
  registerApiSchemaTools(server, vapiClient);
  registerSkillTools(server);
  registerSimulationTools(server, vapiClient);
};
