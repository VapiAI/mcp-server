import { DocsFetcher } from '../utils/docs-fetcher.js';

const fetcher = new DocsFetcher();

export async function handleApiReference(args: {
  endpoint: string;
  method?: string;
  includeExamples?: boolean;
}): Promise<string> {
  const apiDocs = await fetcher.getApiReference();

  const filteredDocs = apiDocs.filter((doc) => {
    const matchesEndpoint =
      doc.title.toLowerCase().includes(args.endpoint.toLowerCase()) ||
      doc.path.toLowerCase().includes(args.endpoint.toLowerCase()) ||
      doc.content.toLowerCase().includes(args.endpoint.toLowerCase());
    return matchesEndpoint;
  });

  if (filteredDocs.length === 0) {
    return `No API reference found for "${args.endpoint}". Try searching for a different endpoint.`;
  }

  let response = `## API Reference for "${args.endpoint}"\n\n`;

  for (const doc of filteredDocs.slice(0, 5)) {
    response += `### ${doc.title}\n`;
    response += `- **URL:** ${doc.url}\n`;
    if (doc.content) {
      const preview = doc.content.substring(0, 500);
      response += `\n${preview}${doc.content.length > 500 ? '...' : ''}\n`;
    }
    response += '\n---\n\n';
  }

  return response;
}
