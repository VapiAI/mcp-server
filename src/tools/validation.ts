import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolResponse } from './utils.js';
import { summarizeInputSchema } from './input-schema.js';

type Issue = z.core.$ZodIssue;
type FieldIssue = {
  path: string; code: string; message: string; allowedValues?: unknown[];
  allowedValuesTruncated?: boolean;
  expected?: string; minimum?: number; maximum?: number; format?: string;
};
const MAX_ISSUES = 12;
const MAX_OPTIONS = 8;
const at = (input: unknown, path: PropertyKey[]) => path.reduce<unknown>((value, key) =>
  value !== null && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[key] : undefined, input);
const fieldPath = (path: PropertyKey[]) => path.map((key, index) =>
  typeof key === 'number' ? `[${key}]` : `${index ? '.' : ''}${String(key)}`).join('') || '$';
const matchesShape = (issues: Issue[], kind: string): boolean => !issues.some(issue => issue.path.length === 0 && (
  issue.code === 'invalid_type' && issue.expected !== kind ||
  issue.code === 'invalid_union' && issue.errors.every(branch => !matchesShape(branch, kind))
));

// Select the supplied provider's branch before formatting a union failure.
// Otherwise a single forbidden field can emit dozens of unrelated providers.
export function validationIssues(issues: Issue[], input: unknown, prefix: PropertyKey[] = []): FieldIssue[] {
  return issues.flatMap((issue): FieldIssue[] => {
    const path = [...prefix, ...issue.path];
    if (issue.code === 'invalid_union') {
      const value = at(input, path);
      const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
      const compatible = issue.errors.filter(branch => matchesShape(branch, kind));
      if (compatible.length === 1) return validationIssues(compatible[0], input, path);
      let record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      // LLM configuration also accepts a JSON string. Decode only to select
      // the correct branch; submitted values never enter the error response.
      if (typeof value === 'string') {
        try {
          const decoded = JSON.parse(value);
          if (decoded && typeof decoded === 'object') record = decoded;
        } catch { /* The JSON parser's existing issue supplies the correction. */ }
      }
      const missingDiscriminator = compatible.length ? ['provider', 'type'].find(key => compatible.every(branch =>
        branch.some(child => child.path.length === 1 && child.path[0] === key && child.code === 'invalid_value'))) : undefined;
      const discriminator = missingDiscriminator ?? (typeof record.provider === 'string' ? 'provider' : typeof record.type === 'string' ? 'type' : undefined);
      if (discriminator) {
        const matches = compatible.filter(branch => !branch.some(child => child.path.length === 1 && child.path[0] === discriminator && child.code === 'invalid_value'));
        if (matches.length === 1) return validationIssues(matches[0], input, path);
        if (matches.length === 0) {
          const options = compatible.flatMap(branch => branch.flatMap(child => child.code === 'invalid_value' && child.path[0] === discriminator ? child.values : []));
          return [optionIssue([...path, discriminator], options)];
        }
      }
      if (compatible.length && compatible.every(branch => branch.every(child => child.path.length === 0 && child.code === 'invalid_value'))) {
        return [optionIssue(path, compatible.flatMap(branch => branch.flatMap(child => child.code === 'invalid_value' ? child.values : [])))];
      }
      const expected = [...new Set(issue.errors.flatMap(branch => branch.flatMap(child => child.code === 'invalid_type' && child.path.length === 0 ? [child.expected] : [])))];
      return [{ path: fieldPath(path), code: 'invalid_union', message: expected.length ? `Expected ${expected.join(' or ')}.` : 'Does not match the supported configuration; check the API schema for this field.' }];
    }
    if (issue.code === 'unrecognized_keys') return issue.keys.map(key => ({
      path: fieldPath([...path, key]), code: 'unrecognized_key',
      message: 'This field is not supported for the selected provider or configuration; remove it.',
    }));
    if (issue.code === 'invalid_value') return [optionIssue(path, issue.values)];
    const detail: FieldIssue = { path: fieldPath(path), code: issue.code, message: issue.message.slice(0, 300) };
    if (issue.code === 'invalid_type') detail.expected = issue.expected;
    if (issue.code === 'too_big' && typeof issue.maximum === 'number') detail.maximum = issue.maximum;
    if (issue.code === 'too_small' && typeof issue.minimum === 'number') detail.minimum = issue.minimum;
    if (issue.code === 'invalid_format') detail.format = issue.format;
    return [detail];
  });
}

function optionIssue(path: PropertyKey[], values: unknown[]): FieldIssue {
  const unique = [...new Set(values)];
  const allowedValues = unique.slice(0, MAX_OPTIONS);
  return {
    path: fieldPath(path), code: 'invalid_value', allowedValues, allowedValuesTruncated: unique.length > MAX_OPTIONS,
    message: `Expected one of: ${allowedValues.map(value => JSON.stringify(value)).join(', ')}${unique.length > MAX_OPTIONS ? ` (and ${unique.length - MAX_OPTIONS} more; see the API schema for this field)` : ''}.`,
  };
}

export function registerValidatedTool<Schema extends z.ZodType>(
  server: McpServer,
  name: string,
  config: { description: string; inputSchema: Schema },
  handler: (params: z.output<Schema>) => Promise<ToolResponse>
) {
  const schema = config.inputSchema;
  // Advertise a compact input summary, but run the full parser exactly once. This
  // boundary lets us format validation failures before the SDK stringifies a
  // raw ZodError. No request reaches the API handler before parsing succeeds.
  const transportSchema = z.object({}).passthrough().meta(summarizeInputSchema(
    z.toJSONSchema(schema, { io: 'input', target: 'draft-07' })
  ));
  return server.registerTool(name, { description: config.description, inputSchema: transportSchema }, async raw => {
    const parsed = await schema.safeParseAsync(raw);
    if (!parsed.success) {
      const all = validationIssues(parsed.error.issues, raw);
      const issues = all.slice(0, MAX_ISSUES);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Input validation error for ${name}:\n${issues.map(issue => `- ${issue.path}: ${issue.message}`).join('\n')}${all.length > MAX_ISSUES ? `\n${all.length - MAX_ISSUES} additional issues omitted.` : ''}\nCorrect the listed fields and retry.` }],
        structuredContent: { validationError: { code: 'INVALID_ARGUMENTS', tool: name, issues, truncated: all.length > MAX_ISSUES } },
      };
    }
    return handler(parsed.data);
  });
}
