import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function createSuccessResponse(data: unknown): CallToolResult {
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

type ExecutionErrorDescriptor = {
  source: 'vapi_api' | 'transport' | 'unknown';
  code: string;
  status?: number;
  tool?: string;
  outcome: 'uncertain' | 'failed';
  recovery: string;
  details?: string[];
  retryAfterMs?: number;
  requestId?: string;
};

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

// Translate recognized diagnostics to fixed text. Upstream messages can
// contain arbitrary submitted values, including credentials without a prefix.
const clientErrorDiagnostics: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:assistant\.)?voice\.voiceId (?:must be one of|is invalid)\b/i, 'Check the voiceId supported by the selected voice provider.'],
  [/^(?:assistant\.)?voice\.provider (?:must be one of|is invalid)\b/i, 'Check the supported voice providers.'],
  [/^(?:assistant\.)?model\.model (?:must be one of|is invalid)\b/i, 'Check the model supported by the selected model provider.'],
  [/^(?:assistant\.)?transcriber\.model (?:must be one of|is invalid)\b/i, 'Check the model supported by the selected transcriber provider.'],
  [/^phone ?number\b[^\r\n]*\bnot found\b/i, 'The phone number was not found. Check the phoneNumberId and connected account.'],
  [/^(?:assistant\b[^\r\n]*\bnot found\b|invalid assistant (?:id|reference)\b)/i, 'Check that the assistant reference exists in the connected account.'],
  [/^tool\b[^\r\n]*\bnot found\b/i, 'Check that the referenced tool exists in the connected account.'],
  [/^(?:missing (?:provider )?credentials?\b|(?:provider )?credentials? (?:not found|missing)\b)/i, 'Check that the required provider credential is configured in Vapi.'],
];

function clientErrorDetails(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const message = (body as { message?: unknown }).message;
  const messages = Array.isArray(message) ? message.slice(0, 10) : [message];
  const details = new Set<string>();
  for (const item of messages) {
    if (typeof item !== 'string') continue;
    const diagnostic = clientErrorDiagnostics.find(([pattern]) => pattern.test(item.slice(0, 512).trim()));
    if (diagnostic) details.add(diagnostic[1]);
  }
  return [...details].slice(0, 3);
}

class WritePreparationError extends Error {
  constructor(cause: unknown) {
    super('Write preparation failed.', { cause });
  }
}

export async function prepareWrite<T>(prepare: () => Promise<T>): Promise<T> {
  try {
    return await prepare();
  } catch (error) {
    throw new WritePreparationError(error);
  }
}

export function createErrorResponse(error: unknown, context: ErrorResponseContext = {}): CallToolResult {
  const preparationError = error instanceof WritePreparationError ? error : undefined;
  const upstreamError: unknown = preparationError ? preparationError.cause : error;
  const write = context.write === true && !preparationError;
  const details = upstreamError && typeof upstreamError === 'object'
    ? upstreamError as { name?: unknown; body?: unknown; rawResponse?: { status?: unknown; headers?: unknown } }
    : undefined;
  const status = statusCodeFrom(upstreamError);
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
  const outcome = write && (
    status === undefined || status === 408 || status === 429 || status >= 500
  ) ? 'uncertain' : 'failed';
  const uncertainCall = outcome === 'uncertain' && context.tool === 'create_call';
  const recovery = uncertainCall
    ? 'Call creation outcome is unknown after one request. Check Vapi call history before retrying.' +
      (status === 429 && retryAfterMs !== undefined ? ' Observe the indicated retry delay.' : '')
    : recoveryFor(status, write, retryAfterMs);
  const action = preparationError
    ? `The write was not attempted. ${recovery}`
    : outcome === 'uncertain' && !uncertainCall
      ? `The request may have reached Vapi. ${recovery}`
      : recovery;
  const upstreamDetails = status !== undefined && status >= 400 && status < 500
    ? clientErrorDetails(details?.body)
    : [];
  const message = context.tool
    ? status === undefined
      ? `${context.tool} failed: ${source === 'transport' ? 'Vapi could not be reached.' : 'execution failed.'} ${action}`
      : `${context.tool} failed: Vapi returned an error (HTTP ${status}). ${action}`
    : status === undefined
      ? `Vapi tool execution failed. ${action}`
      : `Vapi returned an error (HTTP ${status}). ${action}`;
  const errorDescriptor: ExecutionErrorDescriptor = {
    source,
    code,
    ...(status === undefined ? {} : { status }),
    ...(context.tool ? { tool: context.tool } : {}),
    outcome,
    recovery,
    ...(upstreamDetails.length ? { details: upstreamDetails } : {}),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(requestId ? { requestId } : {}),
  };
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: [message, ...upstreamDetails].join(' '),
      },
    ],
    structuredContent: { error: errorDescriptor },
  };
}

// The same safety boundary works for validated registrations and direct SDK
// registrations. Preserve all callback arguments, including SDK request context.
export function withToolErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => CallToolResult | Promise<CallToolResult>,
  context: ErrorResponseContext = {}
): (...args: Args) => Promise<CallToolResult> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return createErrorResponse(error, context);
    }
  };
}

// Success serialization only; registration owns the execution safety boundary.
export function createToolHandler<T>(
  handler: (params: T) => Promise<any>
): (params: T) => Promise<CallToolResult> {
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
): Promise<CallToolResult> => {
  return withToolErrorHandling(async () => createSuccessResponse(await handler()))();
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
): Promise<CallToolResult> => {
  return withErrorHandling(async () => filterResponseWithSchema(await handler(), schema));
};
