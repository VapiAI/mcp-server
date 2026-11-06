import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PublicSkills } from '../knowledge/skills.js';
import { registerSkillTools } from '../tools/skills.js';

const revision = 'a'.repeat(40);
const api = 'https://api.github.com/repos/VapiAI/skills';
const raw = `https://raw.githubusercontent.com/VapiAI/skills/${revision}`;
const assistantSkill = '---\nname: create-assistant\ndescription: >-\n  Create a voice assistant\n  with hooks.\n---\n# Assistant\nUse references/hooks.md for hooks.\n';
const files: Record<string, string> = {
  'create-assistant/SKILL.md': assistantSkill,
  'create-assistant/references/hooks.md': '# Hooks\nThe current hook instructions.',
  'create-assistant/scripts/example.py': 'print("example")',
  'simulations/SKILL.md': '---\nname: simulations\ndescription: Test voice agents with simulations.\n---\n# Simulations\nCreate realistic test scenarios.',
};

function fixtureFetch() {
  return jest.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url === `${api}/commits/main`) return Response.json({ sha: revision });
    if (url === `${api}/git/trees/${revision}?recursive=1`) return Response.json({
      truncated: false,
      tree: [
        ...Object.keys(files).map(path => ({ path, type: 'blob', mode: path.endsWith('.py') ? '100755' : '100644' })),
        { path: 'create-assistant/references/link.md', type: 'blob', mode: '120000' },
        { path: 'create-assistant/image.png', type: 'blob', mode: '100644' },
        { path: 'codex-plugin/skills/generated/SKILL.md', type: 'blob', mode: '100644' },
      ],
    });
    const path = url.slice(raw.length + 1);
    if (url.startsWith(`${raw}/`) && path in files) return new Response(files[path]);
    throw new Error(`Unexpected request: ${url}`);
  });
}

afterEach(() => { jest.restoreAllMocks(); });

describe('public Vapi skills', () => {
  test('browses real root skill directories and searches metadata and instructions with ranked, bounded results', async () => {
    const fetcher = fixtureFetch();
    const skills = new PublicSkills(fetcher);
    const browse = await skills.search('', 1);
    expect(browse.total).toBe(2);
    expect(browse.skills).toHaveLength(1);
    expect(browse.skills[0]).toMatchObject({ name: 'create-assistant', description: 'Create a voice assistant with hooks.' });
    expect(await skills.search('simulations', 10)).toMatchObject({ total: 1, skills: [{ name: 'simulations' }] });
    expect(await skills.search('realistic', 10)).toMatchObject({ total: 1, skills: [{ name: 'simulations' }] });
    expect(await skills.search('no-such-term-xyz', 10)).toMatchObject({ total: 0, skills: [] });
    expect(fetcher).toHaveBeenCalledTimes(4); // Commit, tree, two SKILL.md files; cached across calls.
  });

  test('loads full instructions and text references at one immutable revision, without preloading every skill', async () => {
    const fetcher = fixtureFetch();
    const skills = new PublicSkills(fetcher);
    const result = await skills.load('create-assistant', 'SKILL.md');
    expect(result).toMatchObject({ revision, content: assistantSkill, files: ['SKILL.md', 'references/hooks.md', 'scripts/example.py'] });
    expect(result.sourceUrl).toContain(`/blob/${revision}/`);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const reference = await skills.load('create-assistant', 'references/hooks.md');
    expect(reference.content).toBe(files['create-assistant/references/hooks.md']);
    await skills.load('create-assistant', 'SKILL.md');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  test.each(['../simulations/SKILL.md', 'references/../../simulations/SKILL.md', 'https://example.com/file.md', 'references/%2e%2e/file.md', 'references/link.md', 'image.png'])(
    'rejects unlisted, escaping and non-text paths: %s', async path => {
      const fetcher = fixtureFetch();
      await expect(new PublicSkills(fetcher).load('create-assistant', path)).rejects.toThrow('Unknown skill file');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  test('rejects unknown skills before attempting a file fetch', async () => {
    const fetcher = fixtureFetch();
    await expect(new PublicSkills(fetcher).load('unknown', 'SKILL.md')).rejects.toThrow('search_skills');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('retries after upstream failure and refreshes the snapshot after five minutes', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    const fetcher = fixtureFetch().mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    const skills = new PublicSkills(fetcher);
    await expect(skills.search('', 10)).rejects.toThrow('HTTP 429');
    expect((await skills.search('', 10)).total).toBe(2);
    clock.mockReturnValue(300_001);
    await skills.load('simulations', 'SKILL.md');
    expect(fetcher.mock.calls.filter(([url]) => String(url) === `${api}/commits/main`)).toHaveLength(3);
  });

  test('retries a failed file fetch without refetching successful files or the tree', async () => {
    const fetcher = fixtureFetch();
    const skills = new PublicSkills(fetcher);
    await skills.load('simulations', 'SKILL.md');
    fetcher.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(skills.load('create-assistant', 'SKILL.md')).rejects.toThrow('HTTP 503');
    expect((await skills.load('create-assistant', 'SKILL.md')).content).toBe(assistantSkill);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  test('rejects truncated trees, malformed metadata and oversized files rather than returning incomplete results', async () => {
    const fetcher = fixtureFetch().mockResolvedValueOnce(Response.json({ sha: revision }))
      .mockResolvedValueOnce(Response.json({ truncated: true, tree: [] }));
    await expect(new PublicSkills(fetcher).search('', 10)).rejects.toThrow();
    const malformed = new PublicSkills(fixtureFetch().mockImplementation(async input => {
      if (String(input).endsWith('create-assistant/SKILL.md')) return new Response('No frontmatter');
      return fixtureFetch()(input);
    }));
    await expect(malformed.search('', 10)).rejects.toThrow('frontmatter');
    const oversized = fixtureFetch();
    const skills = new PublicSkills(oversized);
    await skills.load('simulations', 'SKILL.md');
    oversized.mockResolvedValueOnce(new Response('x'.repeat(512_001)));
    await expect(skills.load('create-assistant', 'SKILL.md')).rejects.toThrow('supported size');
  });
});

describe('agent-visible skill tools', () => {
  test('discovers offline, applies defaults, loads references and returns upstream failures as tool errors', async () => {
    const fetcher = fixtureFetch();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetcher);
    const server = new McpServer({ name: 'knowledge-fixture', version: '0' });
    registerSkillTools(server);
    const client = new Client({ name: 'knowledge-client', version: '0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const catalog = await client.listTools();
      expect(catalog.tools.map(tool => tool.name).sort()).toEqual(['load_skill', 'search_skills']);
      expect(fetcher).not.toHaveBeenCalled();
      expect(catalog.tools.every(tool => tool.annotations?.readOnlyHint)).toBe(true);
      const browse = await client.callTool({ name: 'search_skills', arguments: {} });
      expect(browse.structuredContent).toMatchObject({ total: 2 });
      const load = await client.callTool({ name: 'load_skill', arguments: { name: 'create-assistant' } });
      expect(load.structuredContent).toMatchObject({ path: 'SKILL.md', content: assistantSkill });
      const reference = await client.callTool({ name: 'load_skill', arguments: { name: 'create-assistant', path: 'references/hooks.md' } });
      expect(reference.structuredContent).toMatchObject({ content: files['create-assistant/references/hooks.md'] });
      const unknown = await client.callTool({ name: 'load_skill', arguments: { name: 'missing' } });
      expect(unknown.isError).toBe(true);
      const count = fetcher.mock.calls.length;
      for (const [name, args] of [
        ['search_skills', { limit: 0 }], ['load_skill', { name: '../escape' }],
      ] as const) {
        expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
      }
      expect(fetcher).toHaveBeenCalledTimes(count);
      fetcher.mockRejectedValueOnce(new Error('Public skills service unavailable'));
      const failure = await client.callTool({ name: 'load_skill', arguments: { name: 'create-assistant', path: 'scripts/example.py' } });
      expect(failure.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
