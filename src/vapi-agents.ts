import type { z } from 'zod';
import type { AssistantOutputSchema } from './schemas/index.js';
import { ToolError } from './tools/utils.js';

const VAPI_AGENTS_ORIGIN = 'https://agents.vapi.ai';
const VAPI_AGENTS_MCP_URL = `${VAPI_AGENTS_ORIGIN}/api/v1/mcp`;
const VAPI_AGENTS_LOCK_ERROR = 'assistant_managed_by_vapi_agents';
const AGENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

export type ManagedByVapiAgents = { agentId: string; agentUrl: string };

/**
 * Same rule as the Vapi API's lock: only a UUID `metadata.vapiAgentId` counts,
 * and the link is built from it here rather than read from metadata.
 */
export function managedByVapiAgents(
  metadata: unknown
): ManagedByVapiAgents | undefined {
  const agentId = (metadata as { vapiAgentId?: unknown } | null | undefined)
    ?.vapiAgentId;
  if (typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)) {
    return undefined;
  }
  return { agentId, agentUrl: `${VAPI_AGENTS_ORIGIN}/agents/${agentId}` };
}

/** For one assistant when given its agent, otherwise for a list of assistants. */
export function vapiAgentsInstructions(managed?: ManagedByVapiAgents): string {
  const connect = `connect the Vapi Agents MCP server at ${VAPI_AGENTS_MCP_URL} (claude.ai or Claude Desktop: add it as a custom connector and sign in; Claude Code: claude mcp add --transport http vapi-agents ${VAPI_AGENTS_MCP_URL}, then sign in with /mcp)`;
  if (managed) {
    return `This assistant is managed by Vapi Agents (agent ${managed.agentId}), so changes here are locked to keep its experiments valid. Change it in Vapi Agents instead: open ${managed.agentUrl}, or ${connect}. Then call get_agent_status with agentId ${managed.agentId} to see where it stands, and request_improvement with that agentId to request the change. To hand it back to Vapi (for example to delete it), call delete_agent with that agentId; the assistant stays in Vapi, unlocked.`;
  }
  return `Assistants marked managedByVapiAgents are managed by Vapi Agents, so changes here are locked to keep their experiments valid. Change them in Vapi Agents instead: open the agentUrl, or ${connect}. Then call get_agent_status with the agentId to see where it stands, and request_improvement with that agentId to request the change. To hand one back to Vapi, call delete_agent with its agentId.`;
}

export function vapiAgentsNote(
  result: AssistantOutput | AssistantOutput[]
): string | undefined {
  if (Array.isArray(result)) {
    return result.some((assistant) => assistant.managedByVapiAgents)
      ? vapiAgentsInstructions()
      : undefined;
  }
  return result.managedByVapiAgents
    ? vapiAgentsInstructions(result.managedByVapiAgents)
    : undefined;
}

/** The API's 409 for a managed assistant, as a tool error carrying its message. */
export function vapiAgentsLockError(error: unknown): ToolError | undefined {
  const { statusCode, body } = (error ?? {}) as {
    statusCode?: unknown;
    body?: { error?: unknown; message?: unknown };
  };
  if (
    statusCode !== 409 ||
    body?.error !== VAPI_AGENTS_LOCK_ERROR ||
    typeof body.message !== 'string'
  ) {
    return undefined;
  }
  return new ToolError(body.message);
}
