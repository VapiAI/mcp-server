import { DocsFetcher } from '../utils/docs-fetcher.js';

const fetcher = new DocsFetcher();

export async function forceReindex(
  clearCache?: boolean,
  skipVectorIndex?: boolean,
): Promise<string> {
  if (clearCache !== false) {
    await fetcher.invalidateCache();
  }

  await fetcher.getDocumentationStructure();

  const vectorStatus = fetcher.isVectorSearchReady()
    ? `Vector search ready with ${fetcher.getVectorIndexSize()} embeddings`
    : 'Vector search indexing in progress...';

  return `## Re-index Complete\n\n- Cache cleared: ${clearCache !== false}\n- Skip vector index: ${skipVectorIndex || false}\n- ${vectorStatus}`;
}
