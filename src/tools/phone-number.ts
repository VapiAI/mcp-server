import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';

import { transformPhoneNumberOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { GetPhoneNumberInputSchema } from '../schemas/index.js';

export const registerPhoneNumberTools = (
  server: McpServer,
  getClient: () => VapiClient
) => {
  server.tool(
    'list_phone_numbers',
    'Lists all Vapi phone numbers',
    {},
    createToolHandler(async () => {
      const vapiClient = getClient();
      const phoneNumbers = await vapiClient.phoneNumbers.list({ limit: 10 });
      return phoneNumbers.map(transformPhoneNumberOutput);
    })
  );

  server.tool(
    'get_phone_number',
    'Gets details of a specific phone number',
    GetPhoneNumberInputSchema.shape,
    createToolHandler(async (data) => {
      const vapiClient = getClient();
      const phoneNumberId = data.phoneNumberId;
      const phoneNumber = await vapiClient.phoneNumbers.get(phoneNumberId);
      return transformPhoneNumberOutput(phoneNumber);
    })
  );
};
