import { DocsFetcher } from '../utils/docs-fetcher.js';

const fetcher = new DocsFetcher();

export async function getGuides(topic: string, level?: string): Promise<string> {
  const guides = await fetcher.getGuides();

  const filteredGuides = guides.filter((guide) => {
    const matchesTopic =
      guide.title.toLowerCase().includes(topic.toLowerCase()) ||
      guide.content.toLowerCase().includes(topic.toLowerCase());
    return matchesTopic;
  });

  if (filteredGuides.length === 0) {
    return `No guides found for "${topic}". Try searching for a different topic.`;
  }

  let response = `## Guides for "${topic}"\n\n`;

  for (const guide of filteredGuides.slice(0, 5)) {
    response += `### ${guide.title}\n`;
    response += `- **URL:** ${guide.url}\n`;
    response += `- **Section:** ${guide.section}\n`;
    if (guide.content) {
      const preview = guide.content.substring(0, 500);
      response += `\n${preview}${guide.content.length > 500 ? '...' : ''}\n`;
    }
    response += '\n---\n\n';
  }

  return response;
}
