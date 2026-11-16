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
  for (const path of fields) {
    const metadataSize = JSON.stringify({ unavailableFields, truncatedFields, excludedSensitiveFields }).length;
    const remainingTotal = MAX_TOTAL_DETAIL_CHARS - JSON.stringify(output).length - metadataSize - 1_000;
    if (remainingTotal <= 2) {
      truncatedFields.push({ path, reason: 'total-response-size-limit' });
      break;
    }
    const segments = selectAll ? [path] : parseFieldPath(path);
    let value: unknown = source;
    let schemaProperties = false;
    let excludedPath = false;
    for (const segment of segments) {
      if (typeof segment === 'string' && sensitiveKey.test(segment) && !schemaProperties) {
        excludedPath = true;
        break;
      }
      const nextIsSchemaProperties = segment === 'properties' && !!value && typeof value === 'object' && (value as Record<string, unknown>).type === 'object';
      schemaProperties = nextIsSchemaProperties;
      if (typeof segment === 'number') {
        if (!Array.isArray(value) || !Object.hasOwn(value, segment)) {
          value = undefined;
          break;
        }
        value = value[segment];
        continue;
      }
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[segment];
    }
    if (excludedPath) {
      excludedSensitiveFields.push(path);
      continue;
    }
    if (value === undefined) {
      unavailableFields.push(path);
      continue;
    }

    const isArrayField = Array.isArray(value);
    const fieldLimit = Math.max(0, Math.min(
      isArrayField ? DEFAULT_STRING_CHARS : options.limit ?? DEFAULT_STRING_CHARS,
      MAX_STRING_CHARS,
      remainingTotal - 2
    ));
    const arrayLimit = Math.min(
      isArrayField ? options.limit ?? DEFAULT_ARRAY_ITEMS : DEFAULT_ARRAY_ITEMS,
      MAX_ARRAY_ITEMS
    );
    const bounded = boundValue(
      value,
      path,
      options.offset ?? 0,
      fieldLimit,
      arrayLimit,
      truncatedFields,
      excludedSensitiveFields,
      { remaining: fieldLimit + 2 },
      false,
      schemaProperties
    );
    setPath(output, segments, bounded);
  }

  if (unavailableFields.length || truncatedFields.length || excludedSensitiveFields.length) {
    output._mcp = {
      ...(unavailableFields.length > 0 && { unavailableFields }),
      ...(truncatedFields.length > 0 && { truncatedFields }),
      ...(excludedSensitiveFields.length > 0 && { excludedSensitiveFields }),
    };
  }
  // Include compact fields, keys, array padding and metadata in the actual JSON limit.
  if (JSON.stringify(output).length > MAX_TOTAL_DETAIL_CHARS) {
    return { _mcp: { truncatedFields: [{ path: '*', reason: 'total-response-size-limit', recovery: 'Request fewer or narrower fields.' }] } };
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
  nested = false,
  schemaProperties = false
): unknown {
  if (typeof value === 'string') {
    // Avoid forwarding credentials embedded in configuration URLs.
    const safeValue = value
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1[redacted]@')
      .replace(/\b(sips?:)[^/@\s]+@/gi, '$1[redacted]@')
      .replace(/([?&#])([^=&#\s]+)=([^&#\s]*)/g, (entry, separator: string, rawKey: string) => {
        let key = rawKey.replace(/\+/g, ' ');
        try {
          key = decodeURIComponent(key);
        } catch {
          // Keep the undecoded key for the credential-name check.
        }
        return sensitiveKey.test(key) ? `${separator}${rawKey}=[redacted]` : entry;
      });
    const start = nested ? 0 : offset;
    const available = Math.max(0, budget.remaining - 2);
    let low = start;
    let high = Math.min(safeValue.length, start + stringLimit);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (JSON.stringify(safeValue.slice(start, middle)).length - 2 <= available) low = middle;
      else high = middle - 1;
    }
    const end = low;
    if (start > safeValue.length) {
      truncated.push({ path, totalChars: safeValue.length, returnedChars: 0, nextOffset: null });
      return '';
    }
    const result = safeValue.slice(start, end);
    budget.remaining -= JSON.stringify(result).length;
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
      if (sensitiveKey.test(key) && !schemaProperties) {
        excluded.push(childPath);
        continue;
      }
      const keyCost = JSON.stringify(key).length + 1 + (Object.keys(result).length > 0 ? 1 : 0);
      if (budget.remaining <= keyCost + 2) {
        truncated.push({ path: childPath, reason: 'field-size-limit' });
        break;
      }
      budget.remaining -= keyCost;
      result[key] = boundValue(child, childPath, 0, DEFAULT_STRING_CHARS, arrayLimit, truncated, excluded, budget, true, key === 'properties' && (value as Record<string, unknown>).type === 'object');
    }
    return result;
  }
  budget.remaining -= JSON.stringify(value).length;
  return value;
}

type FieldPathSegment = string | number;

function parseFieldPath(path: string): FieldPathSegment[] {
  const segments: FieldPathSegment[] = [];
  for (const match of path.matchAll(/([A-Za-z][A-Za-z0-9]*)(?:\[(\d+)\])?/g)) {
    segments.push(match[1]);
    if (match[2] !== undefined) segments.push(Number(match[2]));
  }
  return segments;
}

function setPath(
  target: Record<string, unknown>,
  path: FieldPathSegment[],
  value: unknown
): void {
  let current: Record<string, unknown> | unknown[] = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    const next = getPathChild(current, segment);
    if (!next || typeof next !== 'object') {
      setPathChild(current, segment, typeof nextSegment === 'number' && nextSegment <= 50 ? [] : {});
    }
    current = getPathChild(current, segment) as Record<string, unknown> | unknown[];
  }
  const last = path[path.length - 1];
  setPathChild(current, last, value);
}

function getPathChild(
  target: Record<string, unknown> | unknown[],
  segment: FieldPathSegment
): unknown {
  return Array.isArray(target)
    ? typeof segment === 'number' ? target[segment] : undefined
    : target[String(segment)];
}

function setPathChild(
  target: Record<string, unknown> | unknown[],
  segment: FieldPathSegment,
  value: unknown
): void {
  if (Array.isArray(target) && typeof segment === 'number') {
    target[segment] = value;
  } else if (!Array.isArray(target)) {
    target[String(segment)] = value;
  }
}
