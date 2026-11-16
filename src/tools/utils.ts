import { z } from 'zod';
import type { ToolExecutionContext } from './execution.js';

export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export function createSuccessResponse(data: any): ToolResponse {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data),
      },
    ],
  };
}

export function createErrorResponse(error: any): ToolResponse {
  const errorMessage = error?.message || String(error);
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
  handler: (params: T, context: ToolExecutionContext) => Promise<any>
): (params: T, context: ToolExecutionContext) => Promise<ToolResponse> {
  return async (params: T, context: ToolExecutionContext) => {
    try {
      const result = await handler(params, context);
      return createSuccessResponse(result);
    } catch (error) {
      if (context.write && context.signal.reason?.name === 'TimeoutError') {
        return { ...createErrorResponse(new Error('The request exceeded its deadline. The write outcome is unknown; check the resource state before retrying.')), isError: true };
      }
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
