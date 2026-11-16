import { z } from 'zod';
import { ToolCreateSchema, ToolUpdateSchema } from './tool-openapi.js';
import { CreateAssistantNameSchema, UpdateAssistantNameSchema, VoiceInputSchema, TranscriberInputSchema, LLMInputSchema, apiField, apiObjectField } from './assistant-openapi.js';

export const EmptyInputSchema = z.object({});

export const ListInputSchema = z.strictObject({
  // Keep discovery compact while validating the full ISO timestamp at runtime.
  before: z.string().meta({ format: 'date-time' }).pipe(z.iso.datetime({ offset: true })).optional().describe(
    'Use pagination.nextBefore to continue.'
  ),
});

// ===== Model Provider and Models =====

export const ModelProvider = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  GoogleAI: 'google',
} as const;

export const OpenAIModels = {
  GPT4o: 'gpt-4o',
  GPT4oMini: 'gpt-4o-mini',
} as const;

export const AnthropicModels = {
  Claude3Sonnet: 'claude-3-7-sonnet-20250219',
  Claude3Haiku: 'claude-3-5-haiku-20241022',
} as const;

export const GoogleModels = {
  GeminiPro: 'gemini-1.5-pro',
  GeminiFlash: 'gemini-1.5-flash',
  Gemini2Flash: 'gemini-2.0-flash',
  Gemini2Pro: 'gemini-2.0-pro',
} as const;

export type ModelProviderType =
  (typeof ModelProvider)[keyof typeof ModelProvider];
export type OpenAIModelType = (typeof OpenAIModels)[keyof typeof OpenAIModels];
export type AnthropicModelType =
  (typeof AnthropicModels)[keyof typeof AnthropicModels];
export type GoogleModelType = (typeof GoogleModels)[keyof typeof GoogleModels];

const LLMSchema = z.union([
  LLMInputSchema,
  z.string().transform((value, ctx) => {
    try { return JSON.parse(value); }
    catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid JSON. Provide an LLM object or a valid JSON object string.' });
      return z.NEVER;
    }
  }).pipe(LLMInputSchema),
]);

export const DEFAULT_LLM = {
  provider: ModelProvider.OpenAI,
  model: OpenAIModels.GPT4o,
};

export type VoiceProviderType = z.infer<typeof VoiceInputSchema>['provider'];

export const DEFAULT_VOICE = {
  provider: '11labs' as VoiceProviderType,
  voiceId: 'sarah',
};

export const DEFAULT_TRANSCRIBER = {
  provider: 'deepgram',
  model: 'nova-3',
};

export const ElevenLabsVoiceIds = {
  Sarah: 'sarah',
  Phillip: 'phillip',
  Steve: 'steve',
  Joseph: 'joseph',
  Myra: 'myra',
} as const;

// ===== Common Schemas =====

export const BaseResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ===== Assistant Schemas =====

export const CreateAssistantInputSchema = z.object({
  name: CreateAssistantNameSchema.describe('Name of the assistant'),
  instructions: apiField<string>('instructions', { nullable: false })
    .optional()
    .default('You are a helpful assistant.')
    .describe('Instructions for the assistant'),
  llm: LLMSchema
    .default(DEFAULT_LLM)
    .describe('LLM configuration'),
  toolIds: apiField<string[]>('toolIds')
    .optional()
    .describe('IDs of tools to use with this assistant'),
  transcriber: TranscriberInputSchema
    .default(DEFAULT_TRANSCRIBER)
    .describe('Transcription configuration'),
  voice: VoiceInputSchema
    .default(DEFAULT_VOICE)
    .describe('Voice configuration'),
  firstMessage: apiField<string>('firstMessage')
    .optional()
    .default('Hello, how can I help you today?')
    .describe('First message to say to the user'),
  firstMessageMode: apiField<'assistant-speaks-first' | 'assistant-waits-for-user' | 'assistant-speaks-first-with-model-generated-message'>('firstMessageMode')
    .optional()
    // Keep the advertised default without applying it to omitted input (Zod 3 behavior).
    .meta({ default: 'assistant-speaks-first' })
    .describe('This determines who speaks first, either assistant or user'),
});

export const AssistantOutputSchema = BaseResponseSchema.extend({
  name: z.string(),
  llm: z.object({
    provider: z.string(),
    model: z.string(),
  }),
  voice: z.object({
    provider: z.string(),
    voiceId: z.string(),
    model: z.string().optional(),
  }),
  transcriber: z.object({
    provider: z.string(),
    model: z.string().optional(),
  }),
  toolIds: z.array(z.string()).optional(),
});

export const GetAssistantInputSchema = z.object({
  assistantId: apiField<string>('assistantId').describe('ID of the assistant to get'),
});

export const UpdateAssistantInputSchema = z.object({
  assistantId: apiField<string>('assistantId').describe('ID of the assistant to update'),
  name: UpdateAssistantNameSchema.optional().describe('New name for the assistant'),
  instructions: apiField<string>('instructions', { nullable: false })
    .optional()
    .describe('New instructions for the assistant'),
  llm: LLMSchema
    .optional()
    .describe('New LLM configuration'),
  toolIds: apiField<string[]>('toolIds')
    .optional()
    .describe('New IDs of tools to use with this assistant'),
  transcriber: TranscriberInputSchema
    .optional()
    .describe('New transcription configuration'),
  voice: VoiceInputSchema
    .optional()
    .describe('New voice configuration'),
  firstMessage: apiField<string>('firstMessage')
    .optional()
    .describe('First message to say to the user'),
  firstMessageMode: apiField<'assistant-speaks-first' | 'assistant-waits-for-user' | 'assistant-speaks-first-with-model-generated-message'>('firstMessageMode')
    .optional()
    .describe('This determines who speaks first, either assistant or user'),
});

// ===== Call Schemas =====

export const CallInputSchema = z.object({
  assistantId: apiField<string>('callAssistantId')
    .optional()
    .describe('ID of the assistant to use for the call'),
  phoneNumberId: apiField<string>('callPhoneNumberId')
    .optional()
    .describe('ID of the phone number to use for the call'),
  customer: z
    .object({
      number: apiField<string>('customerNumber').describe('Customer phone number'),
    })
    .optional()
    .describe('Customer information'),
  scheduledAt: apiField<string>('scheduledAt')
    .optional()
    .describe(
      'ISO datetime string for when the call should be scheduled (e.g. "2025-03-25T22:39:27.771Z")'
    ),
  assistantOverrides: z
    .object({
      variableValues: apiField<Record<string, unknown>>('variableValues')
        .optional()
        .describe(
          'Key-value pairs for dynamic variables to use in the assistant\'s prompts (e.g. {"name": "Joe", "age": "24"})'
        ),
    })
    .optional()
    .describe('Overrides for the assistant configuration'),
});

export const CallOutputSchema = BaseResponseSchema.extend({
  status: z.string(),
  endedReason: z.string().optional(),
  assistantId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  customer: z
    .object({
      number: z.string(),
    })
    .optional(),
  scheduledAt: z.string().optional(),
});

export const GetCallInputSchema = z.object({
  callId: apiField<string>('callId').describe('ID of the call to get'),
});

// ===== Phone Number Schemas =====

export const GetPhoneNumberInputSchema = z.object({
  phoneNumberId: apiField<string>('phoneNumberId').describe('ID of the phone number to get'),
});

export const PhoneNumberOutputSchema = BaseResponseSchema.extend({
  name: z.string().optional(),
  phoneNumber: z.string(),
  status: z.string(),
  capabilities: z
    .object({
      sms: z.boolean().optional(),
      voice: z.boolean().optional(),
    })
    .optional(),
});

// ===== Tool Schemas =====

export const GetToolInputSchema = z.object({
  toolId: apiField<string>('toolId').describe('ID of the tool to get'),
});

export const CreateToolInputSchema = ToolCreateSchema;
export const UpdateToolInputSchema = ToolUpdateSchema;

const ServerSchema = z.object({ url: z.string(), headers: z.record(z.string(), z.string()).optional() });

export const ToolOutputSchema = BaseResponseSchema.extend({
  type: z
    .string()
    .describe('Type of the tool (dtmf, function, mcp, query, etc.)'),
  name: z.string().describe('Name of the tool'),
  description: z.string().describe('Description of the tool'),
  parameters: z.record(z.string(), z.any()).describe('Parameters of the tool'),
  server: ServerSchema.describe('Server of the tool'),
});

// ===== API Schema Lookup =====

export const GetApiSchemaInputSchema = z.object({
  tool: z.enum(['create_tool', 'update_tool']).optional().describe('Discover bundled accepted tool types, or look up a named bundled schema and its examples'),
  name: z
    .string()
    .optional()
    .describe(
      'Exact schema name to return, e.g. "CreateTransferCallToolDTO" or "TransferPlan"'
    ),
  search: z
    .string()
    .optional()
    .describe(
      'Case-insensitive text to find schema names, e.g. "transfer". Used when name is not given.'
    ),
});

export * from './simulation.js';
