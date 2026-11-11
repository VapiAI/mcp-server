import { registerValidatedTool } from './validation.js';
import { readOnly } from './annotations.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient } from '@vapi-ai/server-sdk';

import { transformPhoneNumberOutput } from '../transformers/index.js';
import { createToolHandler } from './utils.js';
import { ListInputSchema, GetPhoneNumberInputSchema } from '../schemas/index.js';
import { createV1ListHandler } from './list.js';

export const registerPhoneNumberTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  registerValidatedTool(
    server,
    'list_phone_numbers',
    {
      description: 'Lists up to 10 Vapi phone numbers',
      inputSchema: ListInputSchema,
      annotations: readOnly('List Phone Numbers'),
    },
    createV1ListHandler(request => vapiClient.phoneNumbers.list(request), transformPhoneNumberOutput)
  );

  registerValidatedTool(
    server,
    'get_phone_number',
    {
      description: 'Gets details of a specific phone number',
      inputSchema: GetPhoneNumberInputSchema,
      annotations: readOnly('Get Phone Number'),
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
