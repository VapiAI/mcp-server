import { transformCallOutput } from '../transformers/index.js';
import { Vapi } from '@vapi-ai/server-sdk';

describe('transformCallOutput', () => {
  // Use type assertion to allow setting all fields including those returned by API
  const mockCallWithMessages = {
    id: 'call-123',
    orgId: 'org-456',
    createdAt: '2025-01-15T10:00:00.000Z',
    updatedAt: '2025-01-15T10:05:00.000Z',
    status: 'ended',
    endedReason: 'assistant-ended-call',
    assistantId: 'asst-789',
    phoneNumberId: 'pn-012',
    customer: {
      number: '+15551234567',
    },
    messages: [
      {
        role: 'assistant',
        message: 'Hello! How can I help you today?',
        time: 1705312800000,
        secondsFromStart: 0,
      },
      {
        role: 'user',
        message: 'I need help with my order.',
        time: 1705312805000,
        secondsFromStart: 5,
      },
      {
        role: 'assistant',
        message: 'Of course! Can you provide your order number?',
        time: 1705312810000,
        secondsFromStart: 10,
      },
    ],
    transcript: 'Hello! How can I help you today?\nI need help with my order.\nOf course! Can you provide your order number?',
    recordingUrl: 'https://example.com/recording.mp3',
    stereoRecordingUrl: 'https://example.com/stereo-recording.mp3',
    costBreakdown: {
      stt: 0.01,
      llm: 0.05,
      tts: 0.02,
      vapi: 0.03,
      total: 0.11,
    },
    cost: 0.11,
  } as Vapi.Call;

  it('should include messages array in the output', () => {
    const result = transformCallOutput(mockCallWithMessages);

    // This test verifies that messages are included in the output
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages!).toHaveLength(3);
    expect(result.messages![0]).toMatchObject({
      role: 'assistant',
      message: 'Hello! How can I help you today?',
    });
  });

  it('should include transcript in the output', () => {
    const result = transformCallOutput(mockCallWithMessages);

    expect(result.transcript).toBeDefined();
    expect(result.transcript).toContain('Hello! How can I help you today?');
  });

  it('should include recording URLs in the output', () => {
    const result = transformCallOutput(mockCallWithMessages);

    expect(result.recordingUrl).toBe('https://example.com/recording.mp3');
    expect(result.stereoRecordingUrl).toBe('https://example.com/stereo-recording.mp3');
  });

  it('should include cost information in the output', () => {
    const result = transformCallOutput(mockCallWithMessages);

    expect(result.cost).toBe(0.11);
    expect(result.costBreakdown).toBeDefined();
    expect(result.costBreakdown!.total).toBe(0.11);
  });

  it('should still include basic call fields', () => {
    const result = transformCallOutput(mockCallWithMessages);

    expect(result.id).toBe('call-123');
    expect(result.createdAt).toBe('2025-01-15T10:00:00.000Z');
    expect(result.updatedAt).toBe('2025-01-15T10:05:00.000Z');
    expect(result.status).toBe('ended');
    expect(result.endedReason).toBe('assistant-ended-call');
    expect(result.assistantId).toBe('asst-789');
    expect(result.phoneNumberId).toBe('pn-012');
    expect(result.customer?.number).toBe('+15551234567');
  });

  it('should handle calls without messages gracefully', () => {
    const callWithoutMessages: Vapi.Call = {
      id: 'call-no-messages',
      orgId: 'org-456',
      createdAt: '2025-01-15T10:00:00.000Z',
      updatedAt: '2025-01-15T10:00:00.000Z',
      status: 'queued',
    };

    const result = transformCallOutput(callWithoutMessages);

    expect(result.id).toBe('call-no-messages');
    expect(result.messages).toBeUndefined();
  });
});
