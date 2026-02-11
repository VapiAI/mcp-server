import { DocsFetcher } from '../utils/docs-fetcher.js';

const fetcher = new DocsFetcher();

export async function getExamples(
  feature: string,
  language?: string,
  framework?: string,
): Promise<string> {
  const examples = await fetcher.getExamples();

  const filteredExamples = examples.filter((ex) => {
    const matchesFeature =
      ex.title.toLowerCase().includes(feature.toLowerCase()) ||
      ex.content.toLowerCase().includes(feature.toLowerCase());
    return matchesFeature;
  });

  if (filteredExamples.length === 0) {
    return `No examples found for "${feature}". Try searching for a different feature.`;
  }

  let response = `## Examples for "${feature}"\n\n`;

  for (const example of filteredExamples.slice(0, 5)) {
    response += `### ${example.title}\n`;
    response += `- **URL:** ${example.url}\n`;
    if (example.content) {
      const preview = example.content.substring(0, 500);
      response += `\n${preview}${example.content.length > 500 ? '...' : ''}\n`;
    }
    response += '\n---\n\n';
  }

  return response;
}
