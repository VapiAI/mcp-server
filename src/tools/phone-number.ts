import { registerValidatedTool } from './validation.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';

import { transformPhoneNumberOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { EmptyInputSchema, GetPhoneNumberInputSchema } from '../schemas/index.js';

export const registerPhoneNumberTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  registerValidatedTool(
    server,
    'list_phone_numbers',
    {
      description: 'Lists all Vapi phone numbers',
      inputSchema: EmptyInputSchema,
    },
    createToolHandler(async () => {
      const phoneNumbers = await vapiClient.phoneNumbers.list({ limit: 10 });
      return phoneNumbers.map(transformPhoneNumberOutput);
    })
  );

  registerValidatedTool(
    server,
    'get_phone_number',
    {
      description: 'Gets details of a specific phone number',
      inputSchema: GetPhoneNumberInputSchema,
    },
    createToolHandler(async (data) => {
      const phoneNumberId = data.phoneNumberId;
      const phoneNumber = await vapiClient.phoneNumbers.get({
        id: phoneNumberId,
      });
      return transformPhoneNumberOutput(phoneNumber);
    })
  );
};
