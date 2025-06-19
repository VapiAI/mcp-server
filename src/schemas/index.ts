import { z } from 'zod';

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

const OpenAILLMSchema = z.object({
  provider: z.literal(ModelProvider.OpenAI),
  model: z.enum([OpenAIModels.GPT4o, OpenAIModels.GPT4oMini] as const),
});

const AnthropicLLMSchema = z.object({
  provider: z.literal(ModelProvider.Anthropic),
  model: z.enum([
    AnthropicModels.Claude3Sonnet,
    AnthropicModels.Claude3Haiku,
  ] as const),
});

const GoogleLLMSchema = z.object({
  provider: z.literal(ModelProvider.GoogleAI),
  model: z.enum([
    GoogleModels.GeminiPro,
    GoogleModels.GeminiFlash,
    GoogleModels.Gemini2Flash,
    GoogleModels.Gemini2Pro,
  ] as const),
});

const GenericLLMSchema = z.object({
  provider: z.string(),
  model: z.string(),
});

const LLMSchema = z.union([
  OpenAILLMSchema,
  AnthropicLLMSchema,
  GoogleLLMSchema,
  GenericLLMSchema,
]);

export const DEFAULT_LLM = {
  provider: ModelProvider.OpenAI,
  model: OpenAIModels.GPT4o,
};

const VoiceProviderSchema = z.enum([
  'vapi',
  '11labs',
  'azure',
  'cartesia',
  'custom-voice',
  'deepgram',
  '11labs',
  'hume',
  'lmnt',
  'neuphonic',
  'openai',
  'playht',
  'rime-ai',
  'smallest-ai',
  'tavus',
  'sesame',
]);

export type VoiceProviderType = z.infer<typeof VoiceProviderSchema>;

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
  name: z.string().describe('Name of the assistant'),
  instructions: z
    .string()
    .optional()
    .default('You are a helpful assistant.')
    .describe('Instructions for the assistant'),
  llm: z
    .union([
      LLMSchema,
      z.string().transform((str) => {
        try {
          return JSON.parse(str);
        } catch (e) {
          throw new Error(`Invalid LLM JSON string: ${str}`);
        }
      }),
    ])
    .default(DEFAULT_LLM)
    .describe('LLM configuration'),
  toolIds: z
    .array(z.string())
    .optional()
    .describe('IDs of tools to use with this assistant'),
  transcriber: z
    .object({
      provider: z.string().describe('Provider to use for transcription'),
      model: z.string().describe('Transcription model to use'),
    })
    .default(DEFAULT_TRANSCRIBER)
    .describe('Transcription configuration'),
  voice: z
    .object({
      provider: VoiceProviderSchema.describe('Provider to use for voice'),
      voiceId: z.string().describe('Voice ID to use'),
      model: z.string().optional().describe('Voice model to use'),
    })
    .default(DEFAULT_VOICE)
    .describe('Voice configuration'),
  firstMessage: z
    .string()
    .optional()
    .default('Hello, how can I help you today?')
    .describe('First message to say to the user'),
  firstMessageMode: z
    .enum([
      'assistant-speaks-first',
      'assistant-waits-for-user',
      'assistant-speaks-first-with-model-generated-message',
    ])
    .default('assistant-speaks-first')
    .optional()
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
    model: z.string(),
  }),
  toolIds: z.array(z.string()).optional(),
});

export const GetAssistantInputSchema = z.object({
  assistantId: z.string().describe('ID of the assistant to get'),
});

export const UpdateAssistantInputSchema = z.object({
  assistantId: z.string().describe('ID of the assistant to update'),
  name: z.string().optional().describe('New name for the assistant'),
  instructions: z
    .string()
    .optional()
    .describe('New instructions for the assistant'),
  llm: z
    .union([
      LLMSchema,
      z.string().transform((str) => {
        try {
          return JSON.parse(str);
        } catch (e) {
          throw new Error(`Invalid LLM JSON string: ${str}`);
        }
      }),
    ])
    .optional()
    .describe('New LLM configuration'),
  toolIds: z
    .array(z.string())
    .optional()
    .describe('New IDs of tools to use with this assistant'),
  transcriber: z
    .object({
      provider: z.string().describe('Provider to use for transcription'),
      model: z.string().describe('Transcription model to use'),
    })
    .optional()
    .describe('New transcription configuration'),
  voice: z
    .object({
      provider: VoiceProviderSchema.describe('Provider to use for voice'),
      voiceId: z.string().describe('Voice ID to use'),
      model: z.string().optional().describe('Voice model to use'),
    })
    .optional()
    .describe('New voice configuration'),
  firstMessage: z
    .string()
    .optional()
    .describe('First message to say to the user'),
  firstMessageMode: z
    .enum([
      'assistant-speaks-first',
      'assistant-waits-for-user',
      'assistant-speaks-first-with-model-generated-message',
    ])
    .optional()
    .describe('This determines who speaks first, either assistant or user'),
});

// ===== Call Schemas =====

export const CallInputSchema = z.object({
  assistantId: z
    .string()
    .optional()
    .describe('ID of the assistant to use for the call'),
  phoneNumberId: z
    .string()
    .optional()
    .describe('ID of the phone number to use for the call'),
  customer: z
    .object({
      number: z.string().describe('Customer phone number'),
    })
    .optional()
    .describe('Customer information'),
  scheduledAt: z
    .string()
    .optional()
    .describe(
      'ISO datetime string for when the call should be scheduled (e.g. "2025-03-25T22:39:27.771Z")'
    ),
  assistantOverrides: z
    .object({
      variableValues: z
        .record(z.string(), z.any())
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
  callId: z.string().describe('ID of the call to get'),
});

// ===== Phone Number Schemas =====

export const GetPhoneNumberInputSchema = z.object({
  phoneNumberId: z.string().describe('ID of the phone number to get'),
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
  toolId: z.string().describe('ID of the tool to get'),
});

const TransferCallDestinationSchema = z.object({
  type: z.literal('number'),
  number: z.string().describe('Phone number to transfer to (e.g., "+16054440129"). It can be any phone number in E.164 format.'),
  extension: z.string().optional().describe('Extension number if applicable'),
  callerId: z.string().optional().describe('Caller ID to use for the transfer'),
  description: z.string().optional().describe('Description of the transfer destination'),
});

// Generic custom tool schemas
const JsonSchemaProperty = z.object({
  type: z.string(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  items: z.any().optional(),
  properties: z.record(z.any()).optional(),
  required: z.array(z.string()).optional(),
});

const JsonSchema = z.object({
  type: z.literal('object'),
  properties: z.record(JsonSchemaProperty),
  required: z.array(z.string()).optional(),
});

const ServerSchema = z.object({
  url: z.string().url().describe('Server URL where the function will be called'),
  headers: z.record(z.string()).optional().describe('Headers to send with the request'),
});

const BackoffPlanSchema = z.object({
  type: z.enum(['fixed', 'exponential']).default('fixed'),
  maxRetries: z.number().default(3).describe('Maximum number of retries'),
  baseDelaySeconds: z.number().default(1).describe('Base delay between retries in seconds'),
});

// Base tool configuration schema (reusable for both create and update)
const BaseToolConfigSchema = z.object({
  // Common fields for all tools
  name: z.string().optional().describe('Name of the function/tool'),
  description: z.string().optional().describe('Description of what the function/tool does'),
  
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
    parameters: JsonSchema.describe('JSON schema for function parameters'),
    server: ServerSchema.describe('Server configuration with URL where the function will be called'),
  }).optional().describe('Custom function tool configuration - for custom server-side functions'),
  
  // API Request tool configuration
  apiRequest: z.object({
    url: z.string().url().describe('URL to make the API request to'),
    method: z.enum(['GET', 'POST']).default('POST').describe('HTTP method for the API request'),
    headers: z.record(z.string()).optional().describe('Headers to send with the request (key-value pairs)'),
    body: JsonSchema.optional().describe('Body schema for the API request in JSON Schema format'),
    backoffPlan: BackoffPlanSchema.optional().describe('Retry configuration for failed API requests'),
    timeoutSeconds: z.number().default(20).describe('Request timeout in seconds'),
  }).optional().describe('API Request tool configuration - for HTTP API integration'),
});

export const CreateToolInputSchema = BaseToolConfigSchema.extend({
  type: z.enum(['sms', 'transferCall', 'function', 'apiRequest'])
    .describe('Type of the tool to create'),
});

export const UpdateToolInputSchema = BaseToolConfigSchema.extend({
  toolId: z.string().describe('ID of the tool to update'),
});

export const ToolOutputSchema = BaseResponseSchema.extend({
  type: z
    .string()
    .describe('Type of the tool (dtmf, function, mcp, query, etc.)'),
  name: z.string().describe('Name of the tool'),
  description: z.string().describe('Description of the tool'),
  parameters: z.record(z.any()).describe('Parameters of the tool'),
  server: ServerSchema.describe('Server of the tool'),
});
