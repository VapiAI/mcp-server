import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';

const expectedToolNames = [
  'create_assistant',
  'create_call',
  'create_tool',
  'get_assistant',
  'get_call',
  'get_phone_number',
  'get_tool',
  'list_assistants',
  'list_calls',
  'list_phone_numbers',
  'list_tools',
  'update_assistant',
  'update_tool',
];

const toolNamePattern =
  /`((?:create|get|list|update|buy|delete)_(?:assistant|assistants|call|calls|phone_number|phone_numbers|tool|tools))`/g;

function documentedToolNames(relativePath: string): string[] {
  const content = readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    'utf8'
  );

  return [...content.matchAll(toolNamePattern)]
    .map((match) => match[1])
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort();
}

describe('public tool documentation', () => {
  test.each(['README.md', 'skill/SKILL.md'])(
    '%s lists exactly the supported MCP tools',
    (relativePath) => {
      expect(documentedToolNames(relativePath)).toEqual(expectedToolNames);
    }
  );
});
