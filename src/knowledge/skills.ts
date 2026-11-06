import { parse } from 'yaml';
import { z } from 'zod';

const REPOSITORY = 'https://github.com/VapiAI/skills';
const API = 'https://api.github.com/repos/VapiAI/skills';
const RAW = 'https://raw.githubusercontent.com/VapiAI/skills';
const CACHE_MS = 5 * 60_000;
const TEXT_FILE = /\.(md|txt|json|ya?ml|py|[cm]?js|ts|sh|rst|toml)$/i;
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });
const treeSchema = z.object({
  truncated: z.literal(false),
  tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string() })),
});

type Skill = { name: string; description: string; content: string };
type Snapshot = {
  revision: string;
  files: Set<string>;
  names: string[];
  contents: Map<string, Promise<string>>;
};

// Each MCP server has its own bounded-lifetime snapshot. Rejected fetches are
// evicted so an upstream outage doesn't poison later calls.
export class PublicSkills {
  private cached?: { expiresAt: number; promise: Promise<Snapshot> };

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async read(url: string, maxBytes = 512_000): Promise<string> {
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vapi-mcp-server' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Public skills request failed (HTTP ${response.status}). Retry later.`);
    }
    if (!response.body) throw new Error('Public skills returned an empty response.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('Public skills response exceeds the supported size.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private snapshot(): Promise<Snapshot> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.promise;
    const promise = (async () => {
      // Pin file reads to one commit so SKILL.md and its references agree even
      // when the public repository changes between requests.
      const { sha } = commitSchema.parse(JSON.parse(await this.read(`${API}/commits/main`)));
      const tree = treeSchema.parse(JSON.parse(await this.read(`${API}/git/trees/${sha}?recursive=1`, 2_000_000)));
      const files = new Set(tree.tree.filter(entry => entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)).map(entry => entry.path));
      const names = [...files].filter(path => /^[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(path)).map(path => path.split('/')[0]).sort();
      if (!names.length) throw new Error('No public Vapi skills were found. Retry later.');
      return { revision: sha, files, names, contents: new Map<string, Promise<string>>() };
    })();
    this.cached = { expiresAt: Date.now() + CACHE_MS, promise };
    void promise.catch(() => { if (this.cached?.promise === promise) this.cached = undefined; });
    return promise;
  }

  private content(snapshot: Snapshot, path: string): Promise<string> {
    const cached = snapshot.contents.get(path);
    if (cached) return cached;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const promise = this.read(`${RAW}/${snapshot.revision}/${encodedPath}`);
    if (snapshot.contents.size >= 100) snapshot.contents.delete(snapshot.contents.keys().next().value!);
    snapshot.contents.set(path, promise);
    void promise.catch(() => snapshot.contents.delete(path));
    return promise;
  }

  private async skill(snapshot: Snapshot, name: string): Promise<Skill> {
    const content = await this.content(snapshot, `${name}/SKILL.md`);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!frontmatter) throw new Error(`Invalid frontmatter for public skill ${name}.`);
    const metadata = z.object({ name: z.literal(name), description: z.string().min(1) }).parse(parse(frontmatter[1]));
    return { name, description: metadata.description, content };
  }

  async search(query: string, limit: number) {
    const snapshot = await this.snapshot();
    const skills: Skill[] = [];
    // Limit concurrent public requests when warming a new snapshot.
    for (let index = 0; index < snapshot.names.length; index += 4) {
      skills.push(...await Promise.all(snapshot.names.slice(index, index + 4).map(name => this.skill(snapshot, name))));
    }
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
    const matches = skills.map(skill => ({
      skill,
      score: terms.reduce((score, term) => score +
        (skill.name.includes(term) ? 5 : 0) +
        (skill.description.toLowerCase().includes(term) ? 3 : 0) +
        (skill.content.toLowerCase().includes(term) ? 1 : 0), 0),
    })).filter(({ score }) => !terms.length || score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
    return {
      repository: REPOSITORY, revision: snapshot.revision, total: matches.length,
      skills: matches.slice(0, limit).map(({ skill }) => ({
        name: skill.name, description: skill.description,
        sourceUrl: `${REPOSITORY}/blob/${snapshot.revision}/${skill.name}/SKILL.md`,
      })),
    };
  }

  async load(name: string, path: string) {
    const snapshot = await this.snapshot();
    if (!snapshot.names.includes(name)) throw new Error(`Unknown public skill. Use search_skills to find a skill name.`);
    const files = [...snapshot.files].filter(file => file.startsWith(`${name}/`) && TEXT_FILE.test(file)).map(file => file.slice(name.length + 1)).sort();
    // Exact tree membership, not URL/path normalization, bounds reads to this
    // skill and excludes traversal, URLs, symlinks and binary assets.
    if (!files.includes(path)) throw new Error('Unknown skill file. Load SKILL.md to see the available files.');
    return {
      name, path, revision: snapshot.revision,
      sourceUrl: `${REPOSITORY}/blob/${snapshot.revision}/${name}/${path}`,
      content: await this.content(snapshot, `${name}/${path}`), files,
    };
  }
}
