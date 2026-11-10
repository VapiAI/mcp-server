import { createErrorResponse, createSuccessResponse } from './utils.js';

const PAGE_SIZE = 10;
const TIE_WARNING = 'V1 cannot safely continue: more than 10 items share the same creation timestamp. No continuation is provided because it would skip items.';

export function v1ListPage<T extends { createdAt: string }>(rows: T[]) {
  let end = Math.min(rows.length, PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;

  // V1 sorts only by creation time. Keep a timestamp group on the same page,
  // using one bounded lookahead row to avoid skipping ties at the boundary.
  if (hasMore) {
    while (end > 0 && rows[end - 1].createdAt === rows[PAGE_SIZE].createdAt) end--;
  }
  const blocked = hasMore && end === 0;
  const results = rows.slice(0, blocked ? PAGE_SIZE : end);
  return {
    results,
    pagination: {
      pageSize: PAGE_SIZE,
      hasMore,
      nextBefore: hasMore && !blocked ? results[results.length - 1].createdAt : null,
      ...(blocked ? { warning: TIE_WARNING } : {}),
    },
  };
}

export function createV1ListHandler<T extends { createdAt: string }, R>(
  list: (request: { limit: number; createdAtLt?: string }) => Promise<T[]>,
  transform: (row: T) => R,
) {
  return async (data: { before?: string }) => {
    try {
      const page = v1ListPage(await list({
        limit: PAGE_SIZE + 1,
        ...(data.before ? { createdAtLt: data.before } : {}),
      }));
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
