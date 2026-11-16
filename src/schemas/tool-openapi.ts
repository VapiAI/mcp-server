import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { inputContract } from './assistant-openapi.js';
import { toolInputContract } from './tool-discovery.js';

type Operation = 'create_tool' | 'update_tool';
export type ToolPayload = Record<string, unknown> & { type: string };
const snapshot = JSON.parse(readFileSync(new URL('./tool-openapi.json', import.meta.url), 'utf8'));
export const toolOperations: Record<Operation, Record<string, string>> = snapshot.operations;
export const toolSchemaSource = snapshot.source;
export const toolDefinitions = snapshot.definitions as Record<string, z.core.JSONSchema.JSONSchema>;
// Small worked requests are disclosed only with the corresponding schema.
// These are configuration examples; credentials and provider setup belong to
// the API documentation and optional create-tool skill references.
export const toolExamples: Record<string, Record<string, unknown>[]> = {
  CreateFunctionToolDTO: [{ type: 'function', function: { name: 'lookup_order', description: 'Look up an order by its ID.', parameters: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] } }, server: { url: 'https://example.com/vapi/tools' } }],
  CreateApiRequestToolDTO: [{ type: 'apiRequest', name: 'lookup_order', method: 'GET', url: 'https://example.com/orders/{{orderId}}' }],
  CreateGoogleSheetsRowAppendToolDTO: [{ type: 'google.sheets.row.append', messages: [{ type: 'request-start', content: 'I will add that to the spreadsheet.' }] }],
};
const validators = new Map<string, z.ZodType>();
function validator(name: string) {
  let schema = validators.get(name);
  if (!schema) {
    const contract = JSON.parse(JSON.stringify(inputContract({ ...toolDefinitions[name], definitions: toolDefinitions }),
      (key, value) => key === '$ref' && typeof value === 'string' ? value.replace('#/components/schemas/', '#/definitions/') : value));
    schema = z.fromJSONSchema(contract, { defaultTarget: 'openapi-3.0' });
    validators.set(name, schema);
  }
  return schema;
}
export function validateToolPayload(operation: Operation, type: unknown, input: unknown, ctx: z.RefinementCtx) {
  const name = typeof type === 'string' ? toolOperations[operation][type] : undefined;
  if (!name) {
    ctx.addIssue({ code: 'invalid_value', path: ['type'], values: Object.keys(toolOperations[operation]) });
    return;
  }
  const result = validator(name).safeParse(input);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ ...issue });
}
// Validate the published DTO without using its parsed result: imports may strip
// extension fields. The SDK receives the original API payload, without MCP defaults.
export const toolCreateInputContract = toolInputContract(toolOperations.create_tool, toolDefinitions);
export const toolUpdateInputContract = toolInputContract(toolOperations.update_tool, toolDefinitions, snapshot.id);
export const ToolCreateSchema = z.record(z.string(), z.unknown()).superRefine((input, ctx) => {
  validateToolPayload('create_tool', input.type, input, ctx);
}) as unknown as z.ZodType<ToolPayload>;
export const ToolUpdateSchema = z.object({ id: z.fromJSONSchema(snapshot.id, { defaultTarget: 'openapi-3.0' }) as z.ZodType<string> }).passthrough();
export function validateToolUpdate(type: string, input: Record<string, unknown>): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    if (value.type !== undefined && value.type !== type) ctx.addIssue({ code: 'custom', path: ['type'], message: 'Tool type must match the existing tool.' });
    validateToolPayload('update_tool', type, value, ctx);
  }).parse(input);
}
