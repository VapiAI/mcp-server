import { DocsFetcher } from '../utils/docs-fetcher.js';

const fetcher = new DocsFetcher();

export class DocumentationSource {
  async getResource(uri: string): Promise<string> {
    const docs = await fetcher.getDocumentationStructure();

    switch (uri) {
      case 'vapi://docs/overview':
        return this.getOverview(docs.pages.length);
      case 'vapi://docs/quickstart':
        return this.getQuickstart();
      case 'vapi://examples/collection':
        return this.getExamplesCollection();
      case 'vapi://api/reference':
        return this.getApiReferenceOverview();
      case 'vapi://changelog/latest':
        return this.getLatestChangelog();
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  private getOverview(pageCount: number): string {
    return `# Vapi Documentation Overview\n\nVapi provides ${pageCount} documentation pages covering voice AI development.\n\nVisit https://docs.vapi.ai for full documentation.`;
  }

  private getQuickstart(): string {
    return `# Vapi Quick Start\n\nGet started with Vapi at https://docs.vapi.ai/quickstart`;
  }

  private getExamplesCollection(): string {
    return `# Vapi Examples\n\nFind code examples at https://docs.vapi.ai/examples`;
  }

  private getApiReferenceOverview(): string {
    return `# Vapi API Reference\n\nFull API reference at https://docs.vapi.ai/api-reference`;
  }

  private getLatestChangelog(): string {
    return `# Latest Changes\n\nSee https://docs.vapi.ai/changelog for recent updates.`;
  }
}
