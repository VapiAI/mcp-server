import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'yaml';
import os from 'os';
import { execSync } from 'child_process';
import { VectorSearch } from './vector-search.js';

export interface DocPage {
  title: string;
  path: string;
  icon?: string;
  content: string;
  url: string;
  category: string;
  section: string;
  level: number;
  rawMdxPath?: string;
}

export interface DocStructure {
  pages: DocPage[];
  sections: Map<string, DocPage[]>;
  categories: Map<string, DocPage[]>;
  lastUpdated: Date;
  version: string;
  repoPath: string;
}

interface DiskCacheEntry {
  data: DocStructure;
  timestamp: number;
  gitHash: string;
}

export class DocsFetcher {
  private docsCache: DocStructure | null = null;
  private VAPI_DOCS_REPO = 'https://github.com/VapiAI/docs.git';
  private CACHE_TTL = 1000 * 60 * 60; // 1 hour
  private CACHE_FILE_PATH = path.join(os.tmpdir(), 'vapi-docs-cache.json');
  private REPO_PATH = path.join(os.tmpdir(), 'vapi-docs-repo');
  private backgroundRefreshPromise: Promise<void> | null = null;
  private vectorSearch = new VectorSearch();
  private vectorIndexingPromise: Promise<void> | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start automatic hourly refresh
    this.startAutoRefresh();
  }

  private startAutoRefresh(): void {
    // Refresh every hour
    this.refreshInterval = setInterval(async () => {
      try {
        console.log('Starting scheduled hourly refresh...');
        await this.invalidateCache();
        await this.getDocumentationStructure();
        console.log('Scheduled refresh completed');
      } catch (error) {
        console.error('Scheduled refresh failed:', error);
      }
    }, this.CACHE_TTL);
    console.log('Automatic hourly refresh scheduled');
  }

  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('Automatic refresh stopped');
    }
  }

  async getDocumentationStructure(): Promise<DocStructure> {
    // Check memory cache first
    if (this.docsCache && Date.now() - this.docsCache.lastUpdated.getTime() < this.CACHE_TTL) {
      return this.docsCache;
    }

    // Try to load from persistent cache
    const cachedData = await this.loadFromDiskCache();
    if (cachedData && Date.now() - cachedData.timestamp < this.CACHE_TTL) {
      this.docsCache = cachedData.data;
      console.log('Loaded documentation from disk cache');

      // Start background vector indexing if not already done
      this.ensureVectorIndexing();

      // Start background refresh if cache is getting old (> 30 minutes)
      const cacheAge = Date.now() - cachedData.timestamp;
      if (cacheAge > 30 * 60 * 1000 && !this.backgroundRefreshPromise) {
        this.backgroundRefreshPromise = this.backgroundRefresh();
      }

      return this.docsCache;
    }

    // Fetch fresh data
    console.log('Fetching fresh documentation from VapiAI/docs repo...');
    return await this.fetchFreshDocumentation();
  }

  private async fetchFreshDocumentation(): Promise<DocStructure> {
    try {
      // Clone or update the repo
      await this.ensureRepoCloned();

      // Get current git hash for cache validation
      const gitHash = this.getGitHash();

      // Parse docs.yml to get the navigation structure
      const docsYmlPath = path.join(this.REPO_PATH, 'fern', 'docs.yml');
      const docsYmlContent = await fs.readFile(docsYmlPath, 'utf-8');
      const docsConfig = yaml.parse(docsYmlContent);

      console.log('Parsing documentation structure from docs.yml...');

      // Parse the navigation structure and extract real content
      const pages = await this.parseNavigationStructure(docsConfig.navigation);

      // Extract actual content from MDX files
      await this.extractRealMdxContent(pages);

      // Organize into sections and categories
      const sections = new Map<string, DocPage[]>();
      const categories = new Map<string, DocPage[]>();

      pages.forEach((page) => {
        // Group by section
        if (!sections.has(page.section)) {
          sections.set(page.section, []);
        }
        sections.get(page.section)!.push(page);

        // Group by category
        if (!categories.has(page.category)) {
          categories.set(page.category, []);
        }
        categories.get(page.category)!.push(page);
      });

      const docStructure: DocStructure = {
        pages,
        sections,
        categories,
        lastUpdated: new Date(),
        version: gitHash.substring(0, 8),
        repoPath: this.REPO_PATH,
      };

      // Save to memory and disk cache
      this.docsCache = docStructure;
      await this.saveToDiskCache({
        data: docStructure,
        timestamp: Date.now(),
        gitHash,
      });

      // Start vector indexing in background
      this.ensureVectorIndexing();

      console.log(`Fetched ${pages.length} documentation pages with real content`);
      return docStructure;
    } catch (error) {
      console.error('Failed to fetch docs structure:', error);

      // Try to return stale cache as fallback
      const staleCache = await this.loadFromDiskCache();
      if (staleCache) {
        console.log('Using stale cache as fallback');
        this.docsCache = staleCache.data;
        return staleCache.data;
      }

      throw new Error(`Failed to fetch docs structure: ${error}`);
    }
  }

  private async ensureRepoCloned(): Promise<void> {
    try {
      // Check if git is available
      try {
        execSync('git --version', { stdio: 'pipe' });
      } catch (error) {
        throw new Error(
          'Git is not installed or not available in PATH. Please install git to use this MCP server.',
        );
      }

      // Check if repo exists and is up to date
      if (await this.isRepoCloned()) {
        console.log('Updating existing repo...');
        try {
          execSync('git fetch origin main', {
            cwd: this.REPO_PATH,
            stdio: 'pipe',
            timeout: 30000,
          });
          execSync('git reset --hard origin/main', {
            cwd: this.REPO_PATH,
            stdio: 'pipe',
            timeout: 10000,
          });
        } catch (error) {
          console.warn('Failed to update repo, will re-clone:', error);
          await fs.rm(this.REPO_PATH, { recursive: true, force: true });
          await this.cloneRepo();
        }
      } else {
        await this.cloneRepo();
      }

      console.log('Repository ready');
    } catch (error) {
      console.error('Failed to clone/update repository:', error);
      throw new Error(`Git operation failed: ${error}`);
    }
  }

  private async cloneRepo(): Promise<void> {
    console.log('Cloning VapiAI/docs repository...');

    // Remove any existing incomplete clone
    try {
      await fs.rm(this.REPO_PATH, { recursive: true, force: true });
    } catch {
      // Ignore error
    }

    try {
      execSync(`git clone --depth 1 ${this.VAPI_DOCS_REPO} ${this.REPO_PATH}`, {
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch (error) {
      console.warn('Shallow clone failed, trying full clone...');
      try {
        await fs.rm(this.REPO_PATH, { recursive: true, force: true });
      } catch {
        // Ignore error
      }
      execSync(`git clone ${this.VAPI_DOCS_REPO} ${this.REPO_PATH}`, {
        stdio: 'pipe',
        timeout: 120000,
      });
    }
  }

  private async isRepoCloned(): Promise<boolean> {
    try {
      const gitDir = path.join(this.REPO_PATH, '.git');
      await fs.access(gitDir);
      return true;
    } catch {
      return false;
    }
  }

  private getGitHash(): string {
    try {
      return execSync('git rev-parse HEAD', {
        cwd: this.REPO_PATH,
        encoding: 'utf-8',
      }).trim();
    } catch {
      return 'unknown';
    }
  }

  private async parseNavigationStructure(navigation: any[]): Promise<DocPage[]> {
    const pages: DocPage[] = [];
    for (const tab of navigation) {
      if (tab.layout) {
        await this.parseLayoutSection(tab.layout, pages, tab.tab, '', 0);
      }
    }
    return pages;
  }

  private async parseLayoutSection(
    layout: any[],
    pages: DocPage[],
    category: string,
    parentSection: string,
    level: number,
  ): Promise<void> {
    for (const item of layout) {
      if (item.section) {
        const sectionName = item.section;
        const currentSection = parentSection
          ? `${parentSection} > ${sectionName}`
          : sectionName;

        if (item.contents) {
          await this.parseLayoutSection(item.contents, pages, category, currentSection, level + 1);
        }
      } else if (item.page && item.path) {
        const rawMdxPath = path.join(this.REPO_PATH, 'fern', item.path);
        const docPage: DocPage = {
          title: item.page,
          path: item.path,
          icon: item.icon,
          content: '', // Will be filled by extractRealMdxContent
          url: `https://docs.vapi.ai/${item.path.replace('.mdx', '')}`,
          category,
          section: parentSection || 'General',
          level,
          rawMdxPath,
        };
        pages.push(docPage);
      } else if (item.link) {
        console.log(`Skipping external link: ${item.link}`);
      }
    }
  }

  private async extractRealMdxContent(pages: DocPage[]): Promise<void> {
    console.log(`Extracting real content from ${pages.length} MDX files...`);

    let extractedCount = 0;
    for (const page of pages) {
      try {
        if (!page.rawMdxPath) continue;

        try {
          await fs.access(page.rawMdxPath);
        } catch {
          console.warn(`File not found: ${page.rawMdxPath}`);
          continue;
        }

        const mdxContent = await fs.readFile(page.rawMdxPath, 'utf-8');
        const extractedContent = this.extractMDXContent(mdxContent);

        if (extractedContent && extractedContent.length > 50) {
          page.content = extractedContent;
          extractedCount++;
        } else {
          console.warn(`No substantial content found in ${page.path}`);
          page.content = `# ${page.title}\n\nNo content available. Visit ${page.url} for more information.`;
        }
      } catch (error) {
        console.warn(`Failed to extract content from ${page.path}:`, error);
        page.content = `# ${page.title}\n\nContent extraction failed. Visit ${page.url} for more information.`;
      }
    }

    console.log(`Successfully extracted content from ${extractedCount}/${pages.length} files`);
  }

  private extractMDXContent(mdxContent: string): string {
    try {
      // Remove frontmatter
      let content = mdxContent.replace(/^---[\s\S]*?---\n?/m, '');

      // Remove import statements
      content = content.replace(/^import\s+.*$/gm, '');

      // Handle common MDX components while preserving content
      content = content
        .replace(/<([A-Z][A-Za-z0-9]*)[^>]*>([\s\S]*?)<\/\1>/g, '$2')
        .replace(/<[A-Z][A-Za-z0-9]*[^>]*\/>/g, '')
        .replace(/<([a-z][a-z0-9]*)[^>]*>([\s\S]*?)<\/\1>/g, '$2')
        .replace(/\{[^}]*\}/g, '')
        .replace(/```([a-z]*)\n([\s\S]*?)\n```/g, '```$1\n$2\n```')
        .replace(/^\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (content.length > 100) {
        return content;
      }

      return '';
    } catch (error) {
      console.warn('Failed to parse MDX content:', error);
      return '';
    }
  }

  private ensureVectorIndexing(): void {
    if (this.vectorIndexingPromise || !this.docsCache) {
      return;
    }
    this.vectorIndexingPromise = this.performVectorIndexing();
  }

  private async performVectorIndexing(): Promise<void> {
    try {
      if (!this.docsCache) return;

      console.log('Starting vector indexing with real content...');
      await this.vectorSearch.initialize();

      if (!this.vectorSearch.isReady()) {
        const pagesWithContent = this.docsCache.pages.filter(
          (p) => p.content && p.content.length > 50,
        );
        await this.vectorSearch.indexDocuments(pagesWithContent);
      }

      console.log('Vector indexing completed');
    } catch (error) {
      console.error('Vector indexing failed:', error);
    } finally {
      this.vectorIndexingPromise = null;
    }
  }

  private async backgroundRefresh(): Promise<void> {
    try {
      console.log('Background refresh started...');
      await this.fetchFreshDocumentation();
      console.log('Background refresh completed');
    } catch (error) {
      console.error('Background refresh failed:', error);
    } finally {
      this.backgroundRefreshPromise = null;
    }
  }

  private async loadFromDiskCache(): Promise<DiskCacheEntry | null> {
    try {
      const cacheData = await fs.readFile(this.CACHE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(cacheData);

      // Reconstruct Maps from plain objects
      parsed.data.sections = new Map(Object.entries(parsed.data.sections || {}));
      parsed.data.categories = new Map(Object.entries(parsed.data.categories || {}));
      parsed.data.lastUpdated = new Date(parsed.data.lastUpdated);

      return parsed;
    } catch (error) {
      return null;
    }
  }

  private async saveToDiskCache(cacheEntry: DiskCacheEntry): Promise<void> {
    try {
      const serializable = {
        ...cacheEntry,
        data: {
          ...cacheEntry.data,
          sections: Object.fromEntries(cacheEntry.data.sections),
          categories: Object.fromEntries(cacheEntry.data.categories),
        },
      };

      await fs.writeFile(this.CACHE_FILE_PATH, JSON.stringify(serializable, null, 2));
    } catch (error) {
      console.warn('Failed to save cache to disk:', error);
    }
  }

  async invalidateCache(): Promise<void> {
    this.docsCache = null;
    await this.vectorSearch.invalidateIndex();
    try {
      await fs.unlink(this.CACHE_FILE_PATH);
      await fs.rm(this.REPO_PATH, { recursive: true, force: true });
      console.log('Cache and repo invalidated');
    } catch (error) {
      // Cache file doesn't exist, that's fine
    }
  }

  async searchDocumentation(
    query: string,
    category?: string,
  ): Promise<{ results: DocPage[]; usedVectorSearch: boolean }> {
    if (!this.docsCache) {
      await this.getDocumentationStructure();
    }

    // Try vector search first (semantic search on actual content)
    if (this.vectorSearch.isReady()) {
      try {
        const vectorResults = await this.vectorSearch.search(query, 5);
        if (vectorResults.length > 0) {
          console.log(`Vector search found ${vectorResults.length} results for "${query}"`);
          let filteredResults = vectorResults;
          if (category) {
            filteredResults = vectorResults.filter((doc) =>
              doc.category.toLowerCase().includes(category.toLowerCase()),
            );
          }
          return { results: filteredResults, usedVectorSearch: true };
        }
      } catch (error) {
        console.error('Vector search failed, falling back to text search:', error);
      }
    }

    // Fallback to text search
    console.log(`Using text search for "${query}"`);
    const textResults = this.textSearchDocumentation(query, category, this.docsCache!);
    return { results: textResults, usedVectorSearch: false };
  }

  private textSearchDocumentation(
    query: string,
    category: string | undefined,
    docs: DocStructure,
  ): DocPage[] {
    const searchTerm = query.toLowerCase();

    return docs.pages
      .filter((page) => {
        const matchesQuery =
          page.title.toLowerCase().includes(searchTerm) ||
          page.content.toLowerCase().includes(searchTerm) ||
          page.section.toLowerCase().includes(searchTerm) ||
          page.path.toLowerCase().includes(searchTerm);

        const matchesCategory =
          !category || page.category.toLowerCase().includes(category.toLowerCase());

        return matchesQuery && matchesCategory;
      })
      .slice(0, 10);
  }

  async getExamples(): Promise<DocPage[]> {
    if (!this.docsCache) {
      await this.getDocumentationStructure();
    }

    return this.docsCache!.pages
      .filter(
        (page) =>
          page.title.toLowerCase().includes('example') ||
          page.title.toLowerCase().includes('quickstart') ||
          page.content.toLowerCase().includes('```'),
      )
      .slice(0, 10);
  }

  async getGuides(): Promise<DocPage[]> {
    if (!this.docsCache) {
      await this.getDocumentationStructure();
    }

    return this.docsCache!.pages
      .filter(
        (page) =>
          page.title.toLowerCase().includes('guide') ||
          page.title.toLowerCase().includes('tutorial') ||
          page.section.toLowerCase().includes('guide'),
      )
      .slice(0, 10);
  }

  async getApiReference(): Promise<DocPage[]> {
    if (!this.docsCache) {
      await this.getDocumentationStructure();
    }

    return this.docsCache!.pages
      .filter(
        (page) =>
          page.path.includes('/api-reference/') ||
          page.title.toLowerCase().includes('api') ||
          page.section.toLowerCase().includes('api'),
      )
      .slice(0, 10);
  }

  isVectorSearchReady(): boolean {
    return this.vectorSearch.isReady();
  }

  getVectorIndexSize(): number {
    return this.vectorSearch.getIndexSize();
  }
}
