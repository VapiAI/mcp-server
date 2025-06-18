import { Vapi } from '@vapi-ai/server-sdk';
import { z } from 'zod';
import {
  CreateAssistantInputSchema,
  CallInputSchema,
  AssistantOutputSchema,
  CallOutputSchema,
  PhoneNumberOutputSchema,
  ToolOutputSchema,
  UpdateAssistantInputSchema,
} from '../schemas/index.js';

// ===== Assistant Transformers =====

export function transformAssistantInput(
  input: z.infer<typeof CreateAssistantInputSchema>
): Vapi.CreateAssistantDto {
  const assistantDto: any = {
    name: input.name,
  };

  assistantDto.model = {
    provider: input.llm.provider as any,
    model: input.llm.model,
  };

  if (input.toolIds && input.toolIds.length > 0) {
    assistantDto.model.toolIds = input.toolIds;
  }

  if (input.instructions) {
    assistantDto.model.messages = [
      {
        role: 'system',
        content: input.instructions,
      },
    ];
  }

  assistantDto.transcriber = {
    provider: input.transcriber.provider,
    ...(input.transcriber.model ? { model: input.transcriber.model } : {}),
  };

  assistantDto.voice = {
    provider: input.voice.provider as any,
    voiceId: input.voice.voiceId,
    ...(input.voice.model ? { model: input.voice.model } : {}),
  };

  if (input.firstMessage) {
    assistantDto.firstMessage = input.firstMessage;
  }

  if (input.firstMessageMode) {
    assistantDto.firstMessageMode = input.firstMessageMode;
  }

  return assistantDto as Vapi.CreateAssistantDto;
}

export function transformUpdateAssistantInput(
  input: z.infer<typeof UpdateAssistantInputSchema>
): Vapi.UpdateAssistantDto {
  const updateDto: any = {};

  if (input.name) {
    updateDto.name = input.name;
  }

  if (input.llm) {
    updateDto.model = {
      provider: input.llm.provider as any,
      model: input.llm.model,
    };

    if (input.toolIds && input.toolIds.length > 0) {
      updateDto.model.toolIds = input.toolIds;
    }

    if (input.instructions) {
      updateDto.model.messages = [
        {
          role: 'system',
          content: input.instructions,
        },
      ];
    }
  } else {
    if (input.toolIds && input.toolIds.length > 0) {
      updateDto.model = { toolIds: input.toolIds };
    }

    if (input.instructions) {
      if (!updateDto.model) updateDto.model = {};
      updateDto.model.messages = [
        {
          role: 'system',
          content: input.instructions,
        },
      ];
    }
  }

  if (input.transcriber) {
    updateDto.transcriber = {
      provider: input.transcriber.provider,
      ...(input.transcriber.model ? { model: input.transcriber.model } : {}),
    };
  }

  if (input.voice) {
    updateDto.voice = {
      provider: input.voice.provider as any,
      voiceId: input.voice.voiceId,
      ...(input.voice.model ? { model: input.voice.model } : {}),
    };
  }

  if (input.firstMessage) {
    updateDto.firstMessage = input.firstMessage;
  }

  if (input.firstMessageMode) {
    updateDto.firstMessageMode = input.firstMessageMode;
  }

  return updateDto as Vapi.UpdateAssistantDto;
}

export function transformAssistantOutput(
  assistant: Vapi.Assistant
): z.infer<typeof AssistantOutputSchema> {
  return {
    id: assistant.id,
    createdAt: assistant.createdAt,
    updatedAt: assistant.updatedAt,
    name: assistant.name || 'Vapi Assistant',
    llm: {
      provider: assistant.model?.provider || 'openai',
      model: assistant.model?.model || 'gpt-4o-mini',
    },
    voice: {
      provider: assistant.voice?.provider || '11labs',
      voiceId: getAssistantVoiceId(assistant.voice),
      model: getAssistantVoiceModel(assistant.voice) || 'eleven_turbo_v2_5',
    },
    transcriber: {
      provider: assistant.transcriber?.provider || 'deepgram',
      model: getAssistantTranscriberModel(assistant.transcriber) || 'nova-3',
    },
    toolIds: assistant.model?.toolIds || [],
  };
}

function getAssistantVoiceId(voice?: Vapi.AssistantVoice): string {
  if (!voice) return '';

  const voiceAny = voice as any;
  return voiceAny.voiceId || voiceAny.voice || '';
}

function getAssistantVoiceModel(voice?: Vapi.AssistantVoice): string {
  if (!voice) return '';

  const voiceAny = voice as any;
  return voiceAny.model || '';
}

function getAssistantTranscriberModel(
  transcriber?: Vapi.AssistantTranscriber
): string {
  if (!transcriber) return '';

  const transcriberAny = transcriber as any;
  return transcriberAny.model || transcriberAny.transcriber || '';
}

// ===== Call Transformers =====

export function transformCallInput(
  input: z.infer<typeof CallInputSchema>
): Vapi.CreateCallDto {
  return {
    ...(input.assistantId ? { assistantId: input.assistantId } : {}),
    ...(input.phoneNumberId ? { phoneNumberId: input.phoneNumberId } : {}),
    ...(input.customer
      ? {
          customer: {
            number: input.customer.number,
          },
        }
      : {}),
    ...(input.scheduledAt
      ? {
          schedulePlan: {
            earliestAt: input.scheduledAt,
          },
        }
      : {}),
    ...(input.assistantOverrides
      ? {
          assistantOverrides: input.assistantOverrides,
        }
      : {}),
  };
}

export function transformCallOutput(
  call: Vapi.Call
): z.infer<typeof CallOutputSchema> {
  return {
    id: call.id,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
    status: call.status || '',
    endedReason: call.endedReason,
    assistantId: call.assistantId,
    phoneNumberId: call.phoneNumberId,
    customer: call.customer
      ? {
          number: call.customer.number || '',
        }
      : undefined,
    scheduledAt: call.schedulePlan?.earliestAt,
  };
}

// ===== Phone Number Transformers =====

export function transformPhoneNumberOutput(
  phoneNumber: any
): z.infer<typeof PhoneNumberOutputSchema> {
  return {
    id: phoneNumber.id,
    name: phoneNumber.name,
    createdAt: phoneNumber.createdAt,
    updatedAt: phoneNumber.updatedAt,
    phoneNumber: phoneNumber.number,
    status: phoneNumber.status,
  };
}

// ===== Tool Transformers =====

export function transformToolOutput(
  tool: any
): z.infer<typeof ToolOutputSchema> {
  return {
    id: tool.id,
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt,
    type: tool.type || '',
    name: tool.function?.name || '',
    description: tool.function?.description || '',
  };
}
