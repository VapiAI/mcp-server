import { searchDocumentation } from './tools/search.js';
import { getExamples } from './tools/examples.js';
import { getGuides } from './tools/guides.js';
import { handleApiReference } from './tools/api-reference.js';
import { getChangelog } from './tools/changelog.js';
import { forceReindex } from './tools/force-reindex.js';
import { DocumentationSource } from './resources/documentation.js';

export class VapiDocsServer {
  private documentationSource: DocumentationSource;

  constructor() {
    this.documentationSource = new DocumentationSource();
  }

  getTools() {
    return [
      {
        name: 'search_documentation',
        description: 'Search Vapi documentation for specific topics, features, or concepts',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'Search query for Vapi documentation',
            },
            category: {
              type: 'string',
              enum: ['api', 'guides', 'examples', 'changelog', 'all'],
              description: 'Category to search within (optional)',
              default: 'all',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
              default: 5,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_examples',
        description: 'Get code examples for specific Vapi features or use cases',
        inputSchema: {
          type: 'object' as const,
          properties: {
            feature: {
              type: 'string',
              description: 'Vapi feature or use case to get examples for',
            },
            language: {
              type: 'string',
              enum: ['javascript', 'typescript', 'python', 'go', 'curl', 'all'],
              description: 'Programming language for examples',
              default: 'typescript',
            },
            framework: {
              type: 'string',
              enum: ['react', 'nextjs', 'express', 'fastapi', 'node', 'all'],
              description: 'Framework for examples (optional)',
              default: 'all',
            },
          },
          required: ['feature'],
        },
      },
      {
        name: 'get_guides',
        description: 'Get step-by-step guides for implementing Vapi features',
        inputSchema: {
          type: 'object' as const,
          properties: {
            topic: {
              type: 'string',
              description: 'Topic or feature to get guides for',
            },
            level: {
              type: 'string',
              enum: ['beginner', 'intermediate', 'advanced', 'all'],
              description: 'Difficulty level of guides',
              default: 'all',
            },
          },
          required: ['topic'],
        },
      },
      {
        name: 'get_api_reference',
        description: 'Get detailed API reference information for Vapi endpoints',
        inputSchema: {
          type: 'object' as const,
          properties: {
            endpoint: {
              type: 'string',
              description: 'API endpoint or resource to get reference for',
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'all'],
              description: 'HTTP method (optional)',
              default: 'all',
            },
            includeExamples: {
              type: 'boolean',
              description: 'Include request/response examples',
              default: true,
            },
          },
          required: ['endpoint'],
        },
      },
      {
        name: 'get_changelog',
        description: 'Get recent changes, updates, and new features in Vapi',
        inputSchema: {
          type: 'object' as const,
          properties: {
            version: {
              type: 'string',
              description: 'Specific version to get changelog for (optional)',
            },
            limit: {
              type: 'number',
              description: 'Number of recent entries to return',
              default: 10,
            },
            type: {
              type: 'string',
              enum: ['features', 'fixes', 'breaking', 'all'],
              description: 'Type of changes to include',
              default: 'all',
            },
          },
        },
      },
      {
        name: 'force_reindex',
        description: 'Force a complete re-index of documentation for testing purposes',
        inputSchema: {
          type: 'object' as const,
          properties: {
            clearCache: {
              type: 'boolean',
              description: 'Whether to clear existing cache before reindexing',
              default: true,
            },
            skipVectorIndex: {
              type: 'boolean',
              description: 'Whether to skip vector index rebuilding',
              default: false,
            },
          },
        },
      },
    ];
  }

  getResources() {
    return [
      {
        uri: 'vapi://docs/overview',
        name: 'Vapi Documentation Overview',
        description: 'Complete overview of Vapi documentation structure',
        mimeType: 'text/markdown',
      },
      {
        uri: 'vapi://docs/quickstart',
        name: 'Vapi Quick Start Guide',
        description: 'Get started with Vapi in minutes',
        mimeType: 'text/markdown',
      },
      {
        uri: 'vapi://examples/collection',
        name: 'Vapi Code Examples Collection',
        description: 'Comprehensive collection of Vapi code examples',
        mimeType: 'text/markdown',
      },
      {
        uri: 'vapi://api/reference',
        name: 'Vapi API Reference',
        description: 'Complete API reference documentation',
        mimeType: 'text/markdown',
      },
      {
        uri: 'vapi://changelog/latest',
        name: 'Latest Changes',
        description: 'Recent updates and new features',
        mimeType: 'text/markdown',
      },
    ];
  }

  async callTool(name: string, args: Record<string, any>) {
    try {
      let result: string;

      switch (name) {
        case 'search_documentation':
          result = await searchDocumentation(args.query, args.category, args.limit);
          break;
        case 'get_examples':
          result = await getExamples(args.feature, args.language, args.framework);
          break;
        case 'get_guides':
          result = await getGuides(args.topic, args.level);
          break;
        case 'get_api_reference':
          result = await handleApiReference(args as { endpoint: string; method?: string; includeExamples?: boolean });
          break;
        case 'get_changelog':
          result = await getChangelog(args.version, args.limit, args.type);
          break;
        case 'force_reindex':
          result = await forceReindex(args.clearCache, args.skipVectorIndex);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
      };
    }
  }

  async readResource(uri: string) {
    try {
      const content = await this.documentationSource.getResource(uri);
      return {
        contents: [
          {
            type: 'text',
            text: content,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        contents: [
          {
            type: 'text',
            text: `Error reading resource: ${errorMessage}`,
          },
        ],
      };
    }
  }
}
