import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VapiClient, Vapi } from '@vapi-ai/server-sdk';

import {
  CreateSquadInputSchema,
  GetSquadInputSchema,
  ListSquadsInputSchema,
  UpdateSquadInputSchema,
} from '../schemas/index.js';
import { createToolHandler } from './utils.js';

export const registerSquadTools = (
  server: McpServer,
  vapiClient: VapiClient
) => {
  server.registerTool(
    'list_squads',
    {
      description:
        'Lists Vapi squads: groups of assistants that hand calls off to each other',
      inputSchema: ListSquadsInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.squads.list({ limit: data.limit ?? 50 })
    )
  );

  server.registerTool(
    'get_squad',
    {
      description: 'Gets a Vapi squad with its members and handoff destinations',
      inputSchema: GetSquadInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.squads.get({ id: data.squadId })
    )
  );

  server.registerTool(
    'create_squad',
    {
      description:
        'Creates a Vapi squad. Each member is an existing assistant (assistantId) or an inline one, with assistantDestinations naming the members it can hand off to.',
      inputSchema: CreateSquadInputSchema.shape,
    },
    createToolHandler(async (data) =>
      vapiClient.squads.create(data as unknown as Vapi.CreateSquadDto)
    )
  );

  server.registerTool(
    'update_squad',
    {
      description:
        'Updates a Vapi squad. Fields you omit keep their current values.',
      inputSchema: UpdateSquadInputSchema.shape,
    },
    createToolHandler(async ({ squadId, ...changes }) => {
      // The API requires `members` on every update and replaces it as a
      // whole, so keep the current members when the update doesn't change
      // them.
      const existing = await vapiClient.squads.get({ id: squadId });
      return vapiClient.squads.update({
        id: squadId,
        members: changes.members ?? existing.members,
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.membersOverrides !== undefined && {
          membersOverrides: changes.membersOverrides,
        }),
      } as unknown as Vapi.UpdateSquadDto);
    })
  );
};
