type DetailOptions = {
  fields?: string[];
  offset?: number;
  limit?: number;
};

const sensitiveKey = /(^auth$|authorization|authentication|cookie|password|secret|token|credential|api.?key|private.?key|headers?)/i;
const MAX_STRING_CHARS = 8_000;
const DEFAULT_STRING_CHARS = 4_000;
const MAX_ARRAY_ITEMS = 50;
const DEFAULT_ARRAY_ITEMS = 20;
const MAX_TOTAL_DETAIL_CHARS = 16_000;

/**
 * Return a compact API-shaped resource and explicitly selected API field paths.
 * Large values are paged or clipped per field; `_mcp` reports absent and
 * truncated data so callers can request the remaining range or narrower path.
 */
export function selectResourceDetails(
  source: Record<string, unknown>,
  baseFields: string[],
  options: DetailOptions = {}
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of baseFields) {
    const segments = field.split('.');
    let value: unknown = source;
    for (const segment of segments) {
      if (sensitiveKey.test(segment) || !value || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[segment];
    }
    if (value !== undefined) {
      setPath(output, segments, value);
    }
  }

  const unavailableFields: string[] = [];
  const truncatedFields: Array<Record<string, unknown>> = [];
  const excludedSensitiveFields: string[] = [];
  const selectAll = options.fields?.includes('*') ?? false;
  const fields = selectAll
    ? Object.keys(source)
    : [...new Set(options.fields ?? [])];
  let remainingTotal = MAX_TOTAL_DETAIL_CHARS;

  for (const path of fields) {
    if (remainingTotal <= 2) {
      truncatedFields.push({ path, reason: 'total-response-size-limit' });
      break;
    }
    const segments = selectAll ? [path] : path.split('.');
    if (segments.some((segment) => sensitiveKey.test(segment))) {
      excludedSensitiveFields.push(path);
      continue;
    }
    let value: unknown = source;
    for (const segment of segments) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[segment];
    }
    if (value === undefined) {
      unavailableFields.push(path);
      continue;
    }

    const fieldLimit = Math.max(0, Math.min(
      options.limit ?? DEFAULT_STRING_CHARS,
      MAX_STRING_CHARS,
      remainingTotal - 2
    ));
    const bounded = boundValue(
      value,
      path,
      options.offset ?? 0,
      fieldLimit,
      Math.min(options.limit ?? DEFAULT_ARRAY_ITEMS, MAX_ARRAY_ITEMS),
      truncatedFields,
      excludedSensitiveFields,
      { remaining: fieldLimit + 2 }
    );
    setPath(output, segments, bounded);
    remainingTotal -= JSON.stringify(bounded).length;
  }

  if (unavailableFields.length || truncatedFields.length || excludedSensitiveFields.length) {
    output._mcp = {
      ...(unavailableFields.length > 0 && { unavailableFields }),
      ...(truncatedFields.length > 0 && { truncatedFields }),
      ...(excludedSensitiveFields.length > 0 && { excludedSensitiveFields }),
    };
  }
  return output;
}

function boundValue(
  value: unknown,
  path: string,
  offset: number,
  stringLimit: number,
  arrayLimit: number,
  truncated: Array<Record<string, unknown>>,
  excluded: string[],
  budget: { remaining: number },
  nested = false
): unknown {
  if (typeof value === 'string') {
    // Avoid forwarding credentials embedded in configuration URLs.
    const safeValue = value
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1[redacted]@')
      .replace(/\b(sips?:)[^/@\s]+@/gi, '$1[redacted]@');
    const start = nested ? 0 : offset;
    const available = Math.max(0, budget.remaining - 2);
    const end = Math.min(safeValue.length, start + stringLimit, start + available);
    if (start > safeValue.length) {
      truncated.push({ path, totalChars: safeValue.length, returnedChars: 0, nextOffset: null });
      return '';
    }
    const result = safeValue.slice(start, end);
    budget.remaining -= result.length + 2;
    if (start > 0 || end < safeValue.length) {
      truncated.push({
        path,
        totalChars: safeValue.length,
        returnedChars: result.length,
        offset: start,
        nextOffset: end < safeValue.length ? end : null,
      });
    }
    return result;
  }
  if (Array.isArray(value)) {
    budget.remaining -= 2;
    const start = nested ? 0 : offset;
    const count = arrayLimit;
    const items: unknown[] = [];
    for (let index = start; index < Math.min(value.length, start + count) && budget.remaining > 2; index += 1) {
      if (items.length > 0) budget.remaining -= 1;
      items.push(boundValue(value[index], `${path}[${index}]`, 0, DEFAULT_STRING_CHARS, arrayLimit, truncated, excluded, budget, true));
    }
    if (start > 0 || start + items.length < value.length || budget.remaining <= 0) {
      truncated.push({
        path,
        totalItems: value.length,
        returnedItems: items.length,
        offset: start,
        nextOffset: start + items.length < value.length ? start + items.length : null,
      });
    }
    return items;
  }
  if (value && typeof value === 'object') {
    budget.remaining -= 2;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (sensitiveKey.test(key)) {
        excluded.push(childPath);
        continue;
      }
      const keyCost = JSON.stringify(key).length + 1 + (Object.keys(result).length > 0 ? 1 : 0);
      if (budget.remaining <= keyCost + 2) {
        truncated.push({ path: childPath, reason: 'field-size-limit' });
        break;
      }
      budget.remaining -= keyCost;
      result[key] = boundValue(child, childPath, 0, DEFAULT_STRING_CHARS, arrayLimit, truncated, excluded, budget, true);
    }
    return result;
  }
  budget.remaining -= JSON.stringify(value).length;
  return value;
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  if (!sensitiveKey.test(path[path.length - 1])) {
    current[path[path.length - 1]] = value;
  }
}
