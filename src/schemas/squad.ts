import { z } from 'zod';

// A squad is a group of assistants that can hand a call off to each other.
// The call starts with the first member.

const SquadMemberDestinationSchema = z
  .object({
    type: z.literal('assistant'),
    assistantName: z
      .string()
      .describe('Name of the squad member to hand off to'),
    description: z
      .string()
      .optional()
      .describe('When to hand off to this member; the assistant uses this to decide'),
    message: z
      .string()
      .optional()
      .describe('What to say to the caller before handing off'),
  })
  // Keep documented fields this schema doesn't list, such as transferMode.
  .passthrough()
  .describe(
    'Handoff destination. Other fields, such as transferMode or contextEngineeringPlan, are sent as given (get_api_schema: TransferDestinationAssistant, HandoffDestinationAssistant).'
  );

const SquadMemberSchema = z
  .object({
    assistantId: z
      .string()
      .optional()
      .describe('ID of an existing assistant. Use this or assistant.'),
    assistant: z
      .record(z.any())
      .optional()
      .describe(
        'Inline assistant configuration, for an assistant that exists only in this squad (get_api_schema: CreateAssistantDTO)'
      ),
    assistantDestinations: z
      .array(SquadMemberDestinationSchema)
      .optional()
      .describe('Other squad members this assistant can hand the call off to'),
    assistantOverrides: z
      .record(z.any())
      .optional()
      .describe("Overrides for this member's settings and template variables (get_api_schema: AssistantOverrides)"),
  })
  // Keep documented fields this schema doesn't list, such as assistantVersion.
  .passthrough()
  .describe('Squad member (get_api_schema: SquadMemberDTO)');

const members = z
  .array(SquadMemberSchema)
  .min(1)
  .describe('Assistants in the squad. The call starts with the first member.');

const membersOverrides = z
  .record(z.any())
  .optional()
  .describe("Overrides applied to every member's settings (get_api_schema: AssistantOverrides)");

export const ListSquadsInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum number of squads to return (default 50)'),
});

export const GetSquadInputSchema = z.object({
  squadId: z.string().describe('ID of the squad'),
});

export const CreateSquadInputSchema = z.object({
  name: z.string().optional().describe('Name of the squad'),
  members,
  membersOverrides,
});

export const UpdateSquadInputSchema = z.object({
  squadId: z.string().describe('ID of the squad to update'),
  name: z.string().optional().describe('New name for the squad'),
  members: members
    .optional()
    .describe(
      'New list of members. Replaces the whole list; omit it to keep the current members.'
    ),
  membersOverrides: membersOverrides.describe(
    "Overrides applied to every member's settings. Replaces the current overrides; omit to keep them (get_api_schema: AssistantOverrides)."
  ),
});
