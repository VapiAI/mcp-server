import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';

import { transformPhoneNumberOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { GetPhoneNumberInputSchema } from '../schemas/index.js';

export const registerPhoneNumberTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  server.registerTool(
    'list_phone_numbers',
    {
      description: 'Lists all Vapi phone numbers',
      inputSchema: {},
    },
    createToolHandler(async () => {
      const phoneNumbers = await vapiClient.phoneNumbers.list({ limit: 10 });
      return phoneNumbers.map(transformPhoneNumberOutput);
    })
  );

  server.tool(
    'get_phone_number',
    'Gets details of a specific phone number',
    GetPhoneNumberInputSchema.shape,
    createToolHandler(async (data) => {
      const phoneNumberId = data.phoneNumberId;
      const phoneNumber = await vapiClient.phoneNumbers.get(phoneNumberId);
      return transformPhoneNumberOutput(phoneNumber);
    })
  );
};
