import { DocsFetcher } from '../utils/docs-fetcher.js';

const fetcher = new DocsFetcher();

export async function searchDocumentation(
  query: string,
  category?: string,
  limit?: number,
): Promise<string> {
  const { results, usedVectorSearch } = await fetcher.searchDocumentation(query, category);

  const limitedResults = limit ? results.slice(0, limit) : results;

  if (limitedResults.length === 0) {
    return `No results found for "${query}". Try a different search term.`;
  }

  const searchMethod = usedVectorSearch ? 'semantic search' : 'text search';
  let response = `## Search Results for "${query}" (using ${searchMethod})\n\n`;

  for (const result of limitedResults) {
    response += `### ${result.title}\n`;
    response += `- **URL:** ${result.url}\n`;
    response += `- **Section:** ${result.section}\n`;
    response += `- **Category:** ${result.category}\n`;

    if (result.content) {
      const preview = result.content.substring(0, 300);
      response += `\n${preview}${result.content.length > 300 ? '...' : ''}\n`;
    }

    response += '\n---\n\n';
  }

  return response;
}
