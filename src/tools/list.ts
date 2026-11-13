import { createErrorResponse, createSuccessResponse } from './utils.js';

const PAGE_SIZE = 10;

export function v1ListPage<T extends { createdAt: string }>(rows: T[], pageSize = PAGE_SIZE) {
  let end = Math.min(rows.length, pageSize);
  const hasMore = rows.length > pageSize;

  // V1 sorts only by creation time. Keep a timestamp group on the same page,
  // using one bounded lookahead row to avoid skipping ties at the boundary.
  if (hasMore) {
    while (end > 0 && rows[end - 1].createdAt === rows[pageSize].createdAt) end--;
  }
  const blocked = hasMore && end === 0;
  const results = rows.slice(0, blocked ? pageSize : end);
  return {
    results,
    pagination: {
      pageSize,
      hasMore,
      nextBefore: hasMore && !blocked ? results[results.length - 1].createdAt : null,
      ...(blocked ? { warning: `V1 cannot safely continue: more than ${pageSize} items share the same creation timestamp. No continuation is provided because it would skip items.` } : {}),
    },
  };
}

export function createV1ListHandler<T extends { createdAt: string }, R, Q extends { limit?: number; createdAtLt?: string }>(
  list: (request: Q) => Promise<T[]>,
  transform: (row: T) => R,
) {
  return async (data: Q & { before?: string }) => {
    try {
      const pageSize = data.limit ?? PAGE_SIZE;
      const request = { ...data, limit: pageSize + 1 };
      delete request.before;
      // A continuation narrows the original query, even if its caller supplies
      // both the API upper bound and the MCP pagination alias.
      if (data.before && (!data.createdAtLt || Date.parse(data.before) < Date.parse(data.createdAtLt))) {
        request.createdAtLt = data.before;
      }
      const page = v1ListPage(await list(request), pageSize);
      const results = page.results.map(transform);
      const response = createSuccessResponse(results);
      return {
        // Preserve the original array in the first text block for existing clients.
        content: [...response.content, {
          type: 'text' as const,
          text: JSON.stringify({ pagination: page.pagination }),
        }],
        structuredContent: { results, pagination: page.pagination },
      };
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}
