export const VAPI_EXECUTION_DEADLINE_MS = 30_000;

export type ToolExecutionContext = { signal: AbortSignal };

type ExecutionSignal = ToolExecutionContext & { dispose: () => void };

export function createExecutionSignal(
  callerSignal?: AbortSignal,
  timeoutMs = VAPI_EXECUTION_DEADLINE_MS,
): ExecutionSignal {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = setTimeout(() => {
    controller.abort(new DOMException(
      `Vapi MCP request exceeded its ${timeoutMs / 1000} second deadline`,
      'TimeoutError',
    ));
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

export function vapiRequestOptions(signal: AbortSignal) {
  return {
    abortSignal: signal,
    // The signal above is the operation-wide deadline; this SDK timeout also
    // bounds each individual network attempt to that same budget.
    timeoutInSeconds: VAPI_EXECUTION_DEADLINE_MS / 1000,
  };
}

// SDK 3.0's retry timer ignores abortSignal. Perform the same status-based
// retries around single SDK attempts so cancellation also interrupts the wait.
function retryDelay(headers: Headers | undefined, attempt: number): number {
  const retryAfter = headers?.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
    const date = new Date(retryAfter).getTime() - Date.now();
    if (!Number.isNaN(date) && date > 0) return Math.min(date, 60_000);
  }
  const reset = parseInt(headers?.get('X-RateLimit-Reset') ?? '', 10);
  if (!Number.isNaN(reset) && reset * 1000 > Date.now()) {
    return Math.min(reset * 1000 - Date.now(), 60_000) * (1 + Math.random() * 0.2);
  }
  return Math.min(1000 * 2 ** attempt, 60_000) * (1 + (Math.random() - 0.5) * 0.2);
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function executeWithRetries<T>(
  signal: AbortSignal,
  retries: number,
  attempt: () => PromiseLike<T>,
): Promise<T> {
  for (let i = 0; ; i++) {
    signal.throwIfAborted();
    try { return await attempt(); }
    catch (error) {
      const failure = error as { statusCode?: number; rawResponse?: { headers?: Headers } };
      const status = failure?.statusCode;
      if (signal.aborted) throw signal.reason;
      if (i >= retries || status === undefined || !(status === 408 || status === 429 || status >= 500)) throw error;
      await waitForRetry(retryDelay(failure.rawResponse?.headers, i), signal);
    }
  }
}

// Keep the SDK's public request options, including an explicit maxRetries: 0.
// Only wrap resource methods used by the MCP tools; do not alter the client.
export function withAbortableRetries<T extends object>(client: T): T {
  const defaultRetries = (client as { _options?: { maxRetries?: number } })._options?.maxRetries ?? 2;
  return new Proxy(client, {
    get(target, key, receiver) {
      const resource = Reflect.get(target, key, receiver);
      if (!resource || typeof resource !== 'object' || key === '_options') return resource;
      return new Proxy(resource, {
        get(object, method, resourceReceiver) {
          const fn = Reflect.get(object, method, resourceReceiver);
          if (typeof fn !== 'function') return fn;
          return (request: unknown, options?: { abortSignal?: AbortSignal; maxRetries?: number }) => {
            if (!options?.abortSignal) return fn.call(object, request, options);
            return executeWithRetries(options.abortSignal, options.maxRetries ?? defaultRetries,
              () => fn.call(object, request, { ...options, maxRetries: 0 }));
          };
        },
      });
    },
  });
}
