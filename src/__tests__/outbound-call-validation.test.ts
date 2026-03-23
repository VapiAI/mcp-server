import {
  transformPhoneNumberOutput,
  transformCallInput,
} from '../transformers/index.js';
import { CallInputSchema, PhoneNumberOutputSchema } from '../schemas/index.js';

describe('Outbound call validation and phone number provider exposure', () => {
  describe('PhoneNumberOutputSchema includes provider field', () => {
    test('schema should have a provider field', () => {
      const shape = PhoneNumberOutputSchema.shape;
      expect(shape).toHaveProperty('provider');
    });
  });

  describe('transformPhoneNumberOutput exposes provider', () => {
    test('should include provider field for a vapi phone number', () => {
      const vapiPhoneNumber = {
        id: 'pn-123',
        name: 'My Vapi Number',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        number: '+15551234567',
        status: 'active',
        provider: 'vapi',
      };

      const result = transformPhoneNumberOutput(vapiPhoneNumber);
      expect(result).toHaveProperty('provider');
      expect(result.provider).toBe('vapi');
    });

    test('should include provider field for a twilio phone number', () => {
      const twilioPhoneNumber = {
        id: 'pn-456',
        name: 'My Twilio Number',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        number: '+15559876543',
        status: 'active',
        provider: 'twilio',
      };

      const result = transformPhoneNumberOutput(twilioPhoneNumber);
      expect(result).toHaveProperty('provider');
      expect(result.provider).toBe('twilio');
    });

    test('should include provider field for a vonage phone number', () => {
      const vonagePhoneNumber = {
        id: 'pn-789',
        name: 'My Vonage Number',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        number: '+15555555555',
        status: 'active',
        provider: 'vonage',
      };

      const result = transformPhoneNumberOutput(vonagePhoneNumber);
      expect(result).toHaveProperty('provider');
      expect(result.provider).toBe('vonage');
    });

    test('should default provider to "unknown" when not present on source', () => {
      const phoneNumberNoProvider = {
        id: 'pn-000',
        name: 'Legacy Number',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        number: '+15550000000',
        status: 'active',
      };

      const result = transformPhoneNumberOutput(phoneNumberNoProvider);
      expect(result).toHaveProperty('provider');
      expect(result.provider).toBe('unknown');
    });
  });

  describe('CallInputSchema.phoneNumberId has outbound guidance in description', () => {
    test('phoneNumberId description should mention Twilio or Vonage for outbound', () => {
      const phoneNumberIdField = CallInputSchema.shape.phoneNumberId;
      const description = phoneNumberIdField.description;
      expect(description).toBeDefined();
      expect(description!.toLowerCase()).toContain('twilio');
      expect(description!.toLowerCase()).toContain('vonage');
      expect(description!.toLowerCase()).toContain('outbound');
    });
  });
});
