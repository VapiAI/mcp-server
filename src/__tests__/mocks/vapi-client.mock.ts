import { jest } from '@jest/globals';

export class MockVapiClient {
  assistants = {
    list: jest.fn(async () => [
      {
        id: 'mock-assistant-id-1',
        name: 'Mock Assistant 1',
        model: 'gpt-4',
        instructions: 'Example instructions',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'mock-assistant-id-2',
        name: 'Mock Assistant 2',
        model: 'claude-3-opus',
        instructions: 'Another example',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]),

    get: jest.fn((id: string) => {
      return Promise.resolve({
        id,
        name: `Mock Assistant ${id}`,
        model: 'gpt-4',
        instructions: 'Example instructions',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }),

    create: jest.fn((data: Record<string, unknown>) => {
      return Promise.resolve({
        id: 'new-mock-assistant-id',
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }),
  };
}

export const createMockVapiClient = () => {
  return new MockVapiClient();
};
