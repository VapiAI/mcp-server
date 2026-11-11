import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PublicSkills } from '../knowledge/skills.js';
import { readOnly } from './annotations.js';

async function knowledgeResult(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `Knowledge request failed: ${error instanceof Error ? error.message : 'Unknown upstream error'}` }] };
  }
}

function jsonResult(data: object): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
}

export function registerSkillTools(server: McpServer) {
  const skills = new PublicSkills();
  server.registerTool('search_skills', {
    description: 'Find Vapi agent skills in the public VapiAI/skills repository by name, description or content. Omit query to browse. Use load_skill to read a result.',
    inputSchema: {
      query: z.string().trim().max(500).default('').describe('Keywords describing the Vapi task, or empty to browse all skills.'),
      limit: z.number().int().min(1).max(30).default(10),
    }, annotations: readOnly('Search Vapi Skills', true),
  }, ({ query, limit }) => knowledgeResult(async () => jsonResult(await skills.search(query, limit))));

  server.registerTool('load_skill', {
    description: 'Read a public Vapi skill or one of its supporting files. Start with SKILL.md, then load relevant files from the returned file list as needed. Returns instructions for this task; does not install skills or execute scripts.',
    inputSchema: {
      name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).describe('Exact skill name from search_skills.'),
      path: z.string().min(1).max(300).default('SKILL.md').describe('File path relative to the skill directory, such as SKILL.md or references/hooks.md.'),
    }, annotations: readOnly('Load Vapi Skill', true),
  }, ({ name, path }) => knowledgeResult(async () => jsonResult(await skills.load(name, path))));
}
