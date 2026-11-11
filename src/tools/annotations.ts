import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

// MCP tool annotations. Clients use these to label tools and decide when to ask
// for confirmation, and directory review requires a title and readOnlyHint.
// openWorldHint is false for calls into the Vapi API itself (a closed domain)
// and true when a tool reaches outside it, such as dialing a phone number.

export const readOnly = (title: string, openWorldHint = false): ToolAnnotations => ({
  title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint,
});

export const creates = (title: string, openWorldHint = false): ToolAnnotations => ({
  title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint,
});

// Updates overwrite fields on an existing resource, so clients should confirm them.
export const updates = (title: string): ToolAnnotations => ({
  title, readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
});
