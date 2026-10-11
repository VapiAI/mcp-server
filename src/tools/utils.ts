import { z } from 'zod';

export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/** A failure whose message is written for the client, returned with `isError`. */
export class ToolError extends Error {}

export function createSuccessResponse(data: any, note?: string): ToolResponse {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data),
      },
      ...(note ? [{ type: 'text' as const, text: note }] : []),
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
    ...(error instanceof ToolError ? { isError: true } : {}),
  };
}

export function createToolHandler<T, R = any>(
  handler: (params: T) => Promise<R>,
  note?: (result: R) => string | undefined
): (params: T) => Promise<ToolResponse> {
  return async (params: T) => {
    try {
      const result = await handler(params);
      return createSuccessResponse(result, note?.(result));
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
