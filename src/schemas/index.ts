import { z } from 'zod';
import { CreateAssistantNameSchema, UpdateAssistantNameSchema, VoiceInputSchema, TranscriberInputSchema, LLMInputSchema, apiField, apiObjectField, requiredToolConfigurations, functionRequiresName } from './assistant-openapi.js';

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

const TransferCallDestinationSchema = apiField<{ type: 'number'; number: string; extension?: string; callerId?: string; description?: string }>('transferDestination', { additionalProperties: true })
  .describe(
    'Transfer destination. Other TransferDestinationNumber fields, such as transferPlan and message, are sent as given (see get_api_schema).'
  );
const FunctionParametersSchema = apiObjectField('functionParameters');
const ApiBodySchema = apiObjectField('apiBody');
// URLs and string-valued headers are retained MCP transport constraints where
// the published DTO describes only a string/object. They are not copied API rules.
const HeaderMapSchema = apiField<Record<string, string>>('serverHeaders').pipe(z.record(z.string(), z.string()))
  .meta({ type: 'object', additionalProperties: { type: 'string' } });

const ServerSchema = z.object({
  url: apiField<string>('serverUrl').pipe(z.string().url()).meta({ format: 'uri' }).describe('Server URL where the function will be called'),
  headers: HeaderMapSchema.optional().describe('Headers to send with the request'),
});

const BackoffPlanSchema = z.object({
  type: apiField<'fixed' | 'exponential'>('backoffType').default('fixed'),
  maxRetries: apiField<number>('backoffMaxRetries').default(3).describe('Maximum number of retries'),
  baseDelaySeconds: apiField<number>('backoffDelay').default(1).describe('Base delay between retries in seconds'),
});

// Base tool configuration schema (reusable for both create and update)
const BaseToolConfigSchema = z.object({
  // Common fields for all tools
  name: apiField<string>('functionName').optional().describe('Name of the function/tool'),
  description: apiField<string>('functionDescription').optional().describe('Description of what the function/tool does'),
  
  // SMS tool configuration
  sms: z.object({
    metadata: z.object({
      from: z.string().describe('Phone number to send SMS from (e.g., "+15551234567"). It must be a twilio number in E.164 format.'),
    }).describe('SMS configuration metadata'),
  }).optional().describe('SMS tool configuration - to send text messages'),
  
  // Transfer call tool configuration
  transferCall: z.object({
    destinations: z.array(TransferCallDestinationSchema).describe('Array of possible transfer destinations'),
  }).optional().describe('Transfer call tool configuration - to transfer calls to destinations'),
  
  // Function tool configuration (custom functions with parameters)
  function: z.object({
    parameters: FunctionParametersSchema.describe('JSON schema for function parameters'),
    server: ServerSchema.describe('Server configuration with URL where the function will be called'),
  }).optional().describe('Custom function tool configuration - for custom server-side functions'),
  
  // API Request tool configuration
  apiRequest: z.object({
    url: apiField<string>('apiUrl').pipe(z.string().url()).meta({ format: 'uri' }).describe('URL to make the API request to'),
    method: apiField<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>('apiMethod').default('POST').describe('HTTP method for the API request'),
    headers: HeaderMapSchema.optional().describe('Headers to send with the request (key-value pairs)'),
    body: ApiBodySchema.optional().describe('Body schema for the API request in JSON Schema format'),
    backoffPlan: BackoffPlanSchema.optional().describe('Retry configuration for failed API requests'),
    timeoutSeconds: apiField<number>('apiTimeout').default(20).describe('Request timeout in seconds'),
  }).optional().describe('API Request tool configuration - for HTTP API integration'),

  // Documented fields the options above don't cover
  additionalFields: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'Other top-level fields from the Vapi API for this tool type, such as messages or rejectionPlan, sent as given. ' +
        'Look them up with get_api_schema, e.g. CreateTransferCallToolDTO. ' +
        'On update_tool, each field given here replaces that whole field.'
    ),
});

export const CreateToolInputSchema = BaseToolConfigSchema.extend({
  type: apiField<'sms' | 'transferCall' | 'function' | 'apiRequest'>('toolType')
    .describe('Type of the tool to create'),
}).superRefine((input, ctx) => {
  if (requiredToolConfigurations.includes(input.type) && !input[input.type]) {
    ctx.addIssue({ code: 'custom', path: [input.type], message: 'This configuration is required for the selected tool type.' });
  }
  if (functionRequiresName && input.type === 'function' && (input.function || input.description) && !input.name) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'A function name is required when providing a function definition.' });
  }
}).meta({ allOf: [
  ...requiredToolConfigurations.map(type => ({ if: { properties: { type: { const: type } }, required: ['type'] }, then: { required: [type] } })),
  ...(functionRequiresName ? [{ if: { properties: { type: { const: 'function' } }, required: ['type'], anyOf: [{ required: ['function'] }, { required: ['description'], properties: { description: { minLength: 1 } } }] }, then: { required: ['name'] } }] : []),
] });

export const UpdateToolInputSchema = BaseToolConfigSchema.extend({
  toolId: apiField<string>('toolId').describe('ID of the tool to update'),
});

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
