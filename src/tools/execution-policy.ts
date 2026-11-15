import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Keep execution policy scoped to each server instance. A WeakSet avoids
// leaking one connection's policy into another or keeping closed servers alive.
const readOnlyServers = new WeakSet<McpServer>();

export function setReadOnlyExecutionPolicy(server: McpServer, readOnly: boolean) {
  if (readOnly) readOnlyServers.add(server);
  else readOnlyServers.delete(server);
}

export function isReadOnlyExecutionPolicy(server: McpServer): boolean {
  return readOnlyServers.has(server);
}
