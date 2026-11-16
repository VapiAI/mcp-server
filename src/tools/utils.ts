import { z } from 'zod';

export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
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

type ErrorResponseContext = { tool?: string; write?: boolean };

const statusCodes: Record<number, string> = {
  400: 'HTTP_BAD_REQUEST',
  401: 'HTTP_UNAUTHORIZED',
  402: 'HTTP_PAYMENT_REQUIRED',
  403: 'HTTP_FORBIDDEN',
  404: 'HTTP_NOT_FOUND',
  408: 'HTTP_REQUEST_TIMEOUT',
  409: 'HTTP_CONFLICT',
  422: 'HTTP_UNPROCESSABLE_ENTITY',
  429: 'HTTP_RATE_LIMITED',
};

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const candidate = headers as { get?: (key: string) => string | null } & Record<string, unknown>;
  const value = typeof candidate.get === 'function'
    ? candidate.get(name)
    : candidate[name] ?? candidate[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

function requestIdFrom(headers: unknown): string | undefined {
  for (const name of ['x-request-id', 'request-id', 'cf-ray']) {
    const value = readHeader(headers, name);
    // Correlation IDs are useful only when they cannot smuggle arbitrary text
    // or customer data into the result.
    if (value && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value)) return value;
  }
  return undefined;
}

function retryAfterFrom(headers: unknown): number | undefined {
  const value = readHeader(headers, 'retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(delay) || delay < 0) return undefined;
  return Math.min(Math.round(delay), 86_400_000);
}

function recoveryFor(status: number | undefined, write: boolean, retryAfterMs?: number): string {
  if (status === 400) return 'Correct the request before trying again.';
  if (status === 401) return 'Check the Vapi credentials and authorize again.';
  if (status === 402) return 'Review the account billing and plan before trying again.';
  if (status === 403) return 'Check that the credentials have permission for this operation.';
  if (status === 404) return 'Check the resource ID and connected account.';
  if (status === 408) return write
    ? 'Verify resource state before retrying the timed-out write.'
    : 'Retry the read later.';
  if (status === 409) return 'Inspect the current resource state and resolve the conflict before retrying.';
  if (status === 422) return 'Correct the request fields before trying again.';
  if (status === 429 && write) return 'Check whether the operation completed before retrying; observe any indicated retry delay.';
  if (status === 429) return retryAfterMs === undefined
    ? 'Wait for the rate limit to clear before trying again.'
    : 'Wait for the indicated retry delay before trying again.';
  if (status !== undefined && status >= 500) return write
    ? 'Retry reads later; verify resource state before retrying a write.'
    : 'Retry the read later.';
  return write
    ? 'Check whether the operation completed before retrying.'
    : 'Check the request and Vapi availability before retrying.';
}

function statusCodeFrom(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

export function createErrorResponse(error: unknown, context: ErrorResponseContext = {}): ToolResponse {
  const details = error && typeof error === 'object'
    ? error as { name?: unknown; rawResponse?: { status?: unknown; headers?: unknown } }
    : undefined;
  const status = statusCodeFrom(error);
  const responseStatus = typeof details?.rawResponse?.status === 'number'
    ? details.rawResponse.status
    : undefined;
  const timedOut = details?.name === 'VapiTimeoutError';
  const source = status !== undefined
    ? 'vapi_api'
    : timedOut || responseStatus === 0 || responseStatus === 499
      ? 'transport'
      : 'unknown';
  const code = status !== undefined
    ? statusCodes[status] ?? (status >= 500 ? 'HTTP_UPSTREAM_UNAVAILABLE' : 'HTTP_ERROR')
    : timedOut
      ? 'UPSTREAM_TIMEOUT'
      : source === 'transport'
        ? 'UPSTREAM_TRANSPORT_ERROR'
        : 'EXECUTION_FAILED';
  const retryAfterMs = retryAfterFrom(details?.rawResponse?.headers);
  const requestId = requestIdFrom(details?.rawResponse?.headers);
  const recovery = recoveryFor(status, context.write === true, retryAfterMs);
  const outcome = context.write === true && (
    status === undefined || status === 408 || status === 429 || status >= 500
  ) ? 'uncertain' : 'failed';
  const action = outcome === 'uncertain'
    ? `The request may have reached Vapi. ${recovery}`
    : recovery;
  const message = context.tool
    ? status === undefined
      ? `${context.tool} failed: ${source === 'transport' ? 'Vapi could not be reached.' : 'execution failed.'} ${action}`
      : `${context.tool} failed: Vapi returned an error (HTTP ${status}). ${action}`
    : status === undefined
      ? `Vapi tool execution failed. ${action}`
      : `Vapi returned an error (HTTP ${status}). ${action}`;
  const errorDescriptor = {
    source,
    code,
    ...(status === undefined ? {} : { status }),
    ...(context.tool ? { tool: context.tool } : {}),
    outcome,
    recovery,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(requestId ? { requestId } : {}),
  };
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: message,
      },
    ],
    structuredContent: { error: errorDescriptor },
  };
}

export function createToolHandler<T>(
  handler: (params: T) => Promise<any>
): (params: T) => Promise<ToolResponse> {
  return async (params: T) => createSuccessResponse(await handler(params));
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
