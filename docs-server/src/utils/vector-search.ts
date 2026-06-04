// FIX(VAP-12030): Use dynamic import() instead of static import for @xenova/transformers.
// @xenova/transformers is an ESM-only package. When TypeScript compiles a static import
// to CJS, it becomes require(), which fails with ERR_REQUIRE_ESM. Dynamic import() works
// in both CJS and ESM contexts.
import NodeCache from 'node-cache';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { DocPage } from './docs-fetcher.js';

interface VectorEntry {
  id: string;
  embedding: number[];
  content: string;
  metadata: DocPage;
}

interface VectorIndex {
  embeddings: VectorEntry[];
  model: string;
  timestamp: number;
}

type Pipeline = (text: string, options?: Record<string, unknown>) => Promise<{ data: ArrayLike<number> }>;

export class VectorSearch {
  private embedder: Pipeline | null = null;
  private cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache
  private vectorIndex: VectorEntry[] = [];
  private readonly VECTOR_CACHE_PATH = path.join(os.tmpdir(), 'vapi-vectors.json');
  private readonly MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
  private initializationPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._initialize();
    return this.initializationPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      console.log('Initializing vector search with local embeddings...');

      // FIX(VAP-12030): Dynamic import() for ESM-only @xenova/transformers package.
      // This avoids the ERR_REQUIRE_ESM error that occurs when TypeScript compiles
      // a static import to require() in CJS output.
      const { pipeline } = await import('@xenova/transformers');

      // Initialize the embedding model
      this.embedder = await pipeline('feature-extraction', this.MODEL_NAME, {
        quantized: true, // Use quantized model for better performance
      }) as unknown as Pipeline;

      // Try to load existing vector index
      await this.loadVectorIndex();

      console.log(`Vector search initialized with ${this.vectorIndex.length} embeddings`);
    } catch (error) {
      console.error('Failed to initialize vector search:', error);
      throw error;
    }
  }

  async indexDocuments(docs: DocPage[]): Promise<void> {
    if (!this.embedder) {
      await this.initialize();
    }

    console.log(`Creating embeddings for ${docs.length} documents...`);

    const embeddings: VectorEntry[] = [];

    // Process documents in batches to avoid memory issues
    const batchSize = 10;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);

      for (const doc of batch) {
        try {
          // Create searchable content from doc metadata
          const searchableContent = this.createSearchableContent(doc);

          // Skip if content is too short
          if (searchableContent.length < 10) continue;

          // Get embedding using local model
          const embedding = await this.getEmbedding(searchableContent);

          embeddings.push({
            id: doc.url,
            embedding,
            content: searchableContent,
            metadata: doc,
          });
        } catch (error) {
          console.warn(`Failed to embed document ${doc.title}:`, error);
        }
      }

      // Show progress
      console.log(
        `Processed ${Math.min(i + batchSize, docs.length)}/${docs.length} documents`,
      );
    }

    this.vectorIndex = embeddings;
    await this.saveVectorIndex();

    console.log(`Created ${embeddings.length} document embeddings`);
  }

  async search(query: string, limit: number = 5, threshold: number = 0.15): Promise<DocPage[]> {
    if (!this.embedder || this.vectorIndex.length === 0) {
      console.log('Vector search not available, falling back to text search');
      return [];
    }

    try {
      // Enhance query for better matching
      const enhancedQuery = this.enhanceQuery(query);

      // Get query embedding
      const queryEmbedding = await this.getEmbedding(enhancedQuery);

      // Calculate similarities
      const similarities = this.vectorIndex.map((doc) => ({
        ...doc,
        similarity: this.cosineSimilarity(queryEmbedding, doc.embedding),
      }));

      // Sort by similarity first
      similarities.sort((a, b) => b.similarity - a.similarity);

      // Log top similarities for debugging
      const topSimilarities = similarities
        .slice(0, 5)
        .map((s) => `${s.metadata.title}: ${s.similarity.toFixed(3)}`);
      console.log(`Top similarities for "${query}": ${topSimilarities.join(', ')}`);

      // Filter by threshold and limit
      const results = similarities
        .filter((doc) => doc.similarity >= threshold)
        .slice(0, limit)
        .map((doc) => doc.metadata);

      console.log(
        `Vector search found ${results.length}/${similarities.length} results above threshold ${threshold} for "${query}"`,
      );
      return results;
    } catch (error) {
      console.error('Vector search failed:', error);
      return [];
    }
  }

  private async getEmbedding(text: string): Promise<number[]> {
    if (!this.embedder) {
      throw new Error('Embedder not initialized');
    }

    // Check cache first
    const cacheKey = `embedding:${text}`;
    const cached = this.cache.get<number[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Generate embedding
    const result = await this.embedder(text, { pooling: 'mean', normalize: true });
    if (!result?.data) {
      throw new Error('Failed to generate embedding');
    }
    const embedding = Array.from(result.data) as number[];

    // Cache the result
    this.cache.set(cacheKey, embedding);

    return embedding;
  }

  private createSearchableContent(doc: DocPage): string {
    const parts: string[] = [];

    // Add title with higher weight (repeat for importance)
    if (doc.title) {
      parts.push(doc.title);
      parts.push(doc.title); // Add twice for importance
    }

    // Add section and category
    if (doc.section) {
      parts.push(doc.section);
    }

    if (doc.category) {
      parts.push(doc.category);
    }

    // Process path to extract meaningful keywords
    if (doc.path) {
      const pathWords = doc.path
        .replace(/[\/\-\_\.]/g, ' ')
        .replace(/([A-Z])/g, ' $1') // Split camelCase
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2 && !['mdx', 'fern', 'docs'].includes(word));
      parts.push(...pathWords);
    }

    // Add URL keywords
    if (doc.url) {
      const urlWords = doc.url
        .replace(/https?:\/\/[^\/]+\//, '') // Remove domain
        .replace(/[\/\-\_\.]/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2 && !['docs', 'vapi', 'ai'].includes(word));
      parts.push(...urlWords);
    }

    // Add actual content - this is the key improvement
    if (doc.content && doc.content.length > 50) {
      // Clean the content and extract meaningful text
      const contentText = doc.content
        // Remove markdown formatting but keep the text
        .replace(/^#+\s*/gm, '') // Remove heading markers
        .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold markers
        .replace(/\*(.*?)\*/g, '$1') // Remove italic markers
        .replace(/`([^`]+)`/g, '$1') // Remove inline code markers
        .replace(/```[\s\S]*?```/g, ' [CODE_BLOCK] ') // Replace code blocks with placeholder
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Extract link text
        .replace(/[^\w\s]/g, ' ') // Remove special characters
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3 && !this.isStopWord(word))
        .slice(0, 200); // Limit to first 200 meaningful words

      parts.push(...contentText);

      // Also add the full content for context (truncated)
      const fullContent = doc.content.substring(0, 1000);
      parts.push(fullContent);
    }

    // Create a rich searchable text
    const searchableText = parts.filter(Boolean).join(' ').toLowerCase().trim();

    return searchableText;
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the',  'and',  'or',   'but',  'in',   'on',   'at',   'to',   'for',  'of',   'with',  'by',
      'from', 'up',   'about','into', 'through','during','before','after','above',
      'below','between','among','through','during','before','after','above',
      'this', 'that', 'these','those','then', 'than', 'such', 'some', 'very',
      'will', 'can',  'could','should','would','may',  'might','must', 'shall',
      'have', 'has',  'had',  'was',  'were', 'been', 'being','are',  'is',   'am',
      'does', 'did',  'do',   'done', 'what', 'when', 'where','how',  'why',  'who',
      'which','what', 'all',  'any',  'each', 'every','few',  'more', 'most',
      'other','another','such','only', 'own',  'same', 'so',   'also', 'just',
      'here', 'there','now',  'then', 'both', 'either','neither','once',
    ]);
    return stopWords.has(word);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) {
      throw new Error('Vectors must be defined and have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  private async loadVectorIndex(): Promise<void> {
    try {
      const data = await fs.readFile(this.VECTOR_CACHE_PATH, 'utf-8');
      const index: VectorIndex = JSON.parse(data);

      // Check if index is recent and uses same model
      const isStale = Date.now() - index.timestamp > 24 * 60 * 60 * 1000; // 24 hours
      const isDifferentModel = index.model !== this.MODEL_NAME;

      if (isStale || isDifferentModel) {
        console.log('Vector index is stale or uses different model');
        this.vectorIndex = [];
        return;
      }

      this.vectorIndex = index.embeddings;
      console.log(`Loaded ${this.vectorIndex.length} embeddings from cache`);
    } catch (error) {
      // Cache file doesn't exist or is corrupted
      this.vectorIndex = [];
    }
  }

  private async saveVectorIndex(): Promise<void> {
    try {
      const index: VectorIndex = {
        embeddings: this.vectorIndex,
        model: this.MODEL_NAME,
        timestamp: Date.now(),
      };

      await fs.writeFile(this.VECTOR_CACHE_PATH, JSON.stringify(index));
      console.log('Saved vector index to disk');
    } catch (error) {
      console.warn('Failed to save vector index:', error);
    }
  }

  async invalidateIndex(): Promise<void> {
    this.vectorIndex = [];
    this.cache.flushAll();

    try {
      await fs.unlink(this.VECTOR_CACHE_PATH);
      console.log('Vector index invalidated');
    } catch (error) {
      // File doesn't exist, that's fine
    }
  }

  getIndexSize(): number {
    return this.vectorIndex.length;
  }

  isReady(): boolean {
    return this.embedder !== null && this.vectorIndex.length > 0;
  }

  private enhanceQuery(query: string): string {
    // Add common variations and synonyms for better matching
    const queryLower = query.toLowerCase();
    const enhancements: string[] = [query];

    // Add variations for common terms
    if (queryLower.includes('mcp')) {
      enhancements.push(
        'model context protocol',
        'tools integration',
        'dynamic tools',
        'mcp server',
        'mcp client',
      );
    }

    if (queryLower.includes('claude') && queryLower.includes('desktop')) {
      enhancements.push(
        'claude desktop configuration',
        'mcp client setup',
        'claude_desktop_config.json',
      );
    }

    if (queryLower.includes('assistant')) {
      enhancements.push('voice ai', 'chatbot', 'agent', 'conversation', 'voice assistant');
    }

    if (queryLower.includes('call')) {
      enhancements.push('phone', 'telephony', 'voice call', 'conversation', 'calling');
    }

    if (queryLower.includes('api')) {
      enhancements.push('endpoint', 'rest api', 'integration', 'webhook', 'reference');
    }

    if (queryLower.includes('tool')) {
      enhancements.push('function', 'integration', 'webhook', 'action', 'tools');
    }

    if (queryLower.includes('phone')) {
      enhancements.push('telephony', 'call', 'number', 'sip', 'phone number');
    }

    if (queryLower.includes('voice')) {
      enhancements.push('speech', 'audio', 'tts', 'synthesis', 'voice');
    }

    if (queryLower.includes('example')) {
      enhancements.push('code', 'sample', 'demo', 'tutorial', 'guide');
    }

    if (queryLower.includes('config')) {
      enhancements.push('configuration', 'setup', 'settings', 'configure');
    }

    if (queryLower.includes('webhook')) {
      enhancements.push('callback', 'endpoint', 'integration', 'http', 'api');
    }

    return enhancements.join(' ');
  }
}
