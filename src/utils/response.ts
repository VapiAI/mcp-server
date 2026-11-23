export function parseToolResponse(response: any): any {
  if (!response || typeof response !== 'object') return response;

  const text = Array.isArray(response.content)
    ? response.content.find((item: { type: string; text?: string }) => item.type === 'text')?.text
    : undefined;

  if (response.isError === true) return { error: text || 'Tool execution failed.' };
  if (!text) return response;
  // Keep accepting the text format used by older tool responses.
  if (text.startsWith('Error:')) return { error: text };

  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('Failed to parse text content as JSON:', error);
    return text;
  }
}
