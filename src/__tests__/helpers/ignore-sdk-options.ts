// Existing contract tests focus on request payloads. The real SDK request
// options are exercised by mcp-cancellation.test.ts.
export function ignoreSdkRequestOptions<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, resourceName, receiver) {
      const resource = Reflect.get(target, resourceName, receiver);
      if (typeof resource === 'function') return (request: unknown) => resource.call(target, request);
      if (!resource || typeof resource !== 'object') return resource;
      return new Proxy(resource, {
        get(resourceTarget, operationName, resourceReceiver) {
          const operation = Reflect.get(resourceTarget, operationName, resourceReceiver);
          return typeof operation === 'function'
            ? (request: unknown, options?: { headers?: unknown }) => operationName === 'simulationRunControllerCreate'
              ? operation.call(resourceTarget, request, options?.headers ? { headers: options.headers } : undefined)
              : operation.call(resourceTarget, request)
            : operation;
        },
      });
    },
  });
}
