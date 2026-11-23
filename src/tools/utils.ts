import { z } from 'zod';
import { redactCredentials, redactErrorMessage } from '../utils/credential-redaction.js';

export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

export function createSuccessResponse(data: any): ToolResponse {
  const safeData = redactCredentials(data);
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof safeData === 'string' ? safeData : JSON.stringify(safeData),
      },
    ],
  };
}

export function createErrorResponse(error: any): ToolResponse {
  const errorMessage = redactErrorMessage(error);
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: ${errorMessage}`,
      },
    ],
  };
}

export function createToolHandler<T>(
  handler: (params: T) => Promise<any>
): (params: T) => Promise<ToolResponse> {
  return async (params: T) => {
    try {
      const result = await handler(params);
      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}

export function createParamsSchema<T>(schema: z.ZodType<T>): any {
  return {
    properties: {
      params: (schema as any).shape || {},
    },
    required: ['params'],
  };
}

export function createIdParamSchema(
  paramName: string,
  description: string
): any {
  return {
    properties: {
      [paramName]: { type: 'string', description },
    },
    required: [paramName],
  };
}

export const withErrorHandling = <T>(
  handler: () => Promise<T>
): Promise<ToolResponse> => {
  return handler()
    .then((result) => createSuccessResponse(result))
    .catch((error) => createErrorResponse(error));
};

export const filterResponseWithSchema = <T>(
  data: any,
  schema: z.ZodType<T>
): T => {
  if (Array.isArray(data)) {
    return data.map((item) => schema.parse(item)) as unknown as T;
  }
  return schema.parse(data);
};

export const withSchemaFiltering = <T>(
  handler: () => Promise<any>,
  schema: z.ZodType<T>
): Promise<ToolResponse> => {
  return handler()
    .then((result) => {
      const filtered = filterResponseWithSchema(result, schema);
      return createSuccessResponse(filtered);
    })
    .catch((error) => createErrorResponse(error));
};
