import { expect, test } from 'bun:test';
import { searchTools, toolSearchTool } from '../toolSearch.js';

const tools = [
  { name: 'github__create_issue', description: 'Open an issue in a repository.', server: 'github' },
  { name: 'github__list_issues', description: 'List the issues of a repository.', server: 'github' },
  { name: 'db__query', description: 'Run a read-only SQL query.', server: 'db' },
];

test('words in the name rank above words in the description, and nothing unrelated is returned', () => {
  expect(searchTools(tools, 'create issue').map((tool) => tool.name)).toEqual(['github__create_issue', 'github__list_issues']);
  expect(searchTools(tools, 'sql').map((tool) => tool.name)).toEqual(['db__query']);
  expect(searchTools(tools, 'weather')).toEqual([]);
  expect(searchTools(tools, '  ')).toEqual([]);
  expect(searchTools(tools, 'issue', 1)).toHaveLength(1);
});

test('the tool loads what it finds, or exact names after select:', async () => {
  const loaded: string[][] = [];
  const tool = toolSearchTool({ deferred: () => tools, load: (names) => loaded.push(names) });
  const found = await tool.runner({ query: 'select:db__query, nope' }, {} as any);
  expect(loaded).toEqual([['db__query']]);
  expect(found.output).toContain('- db__query (MCP server db): Run a read-only SQL query.');
  const none = await tool.runner({ query: 'weather' }, {} as any);
  expect(none.output).toBe('No tool that is not listed yet matches "weather". 3 tools are held back.');
  expect(loaded).toHaveLength(1);
});
