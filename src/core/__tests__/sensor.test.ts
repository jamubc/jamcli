import { test, expect } from 'bun:test';
import { detectIntent, selectToolsForQuery, userQueryNeedsTools } from '../sensor.js';
import type { McpToolDescriptor } from '../../types/mcp.js';

const tools: McpToolDescriptor[] = [
  { name: 'list_files', description: 'List project files', source: 'builtin' },
  { name: 'read_file', description: 'Read file content', source: 'builtin' },
  { name: 'search_code', description: 'Search the codebase', source: 'builtin' },
  { name: 'search_tools', description: 'Discover MCP tools', source: 'builtin' },
  { name: 'run_command', description: 'Execute shell commands', source: 'builtin' },
  { name: 'ext__grep', description: 'Search remote code', source: 'server', serverId: 'ext' },
];

const names = (selected: McpToolDescriptor[]) => selected.map((t) => t.name);

test('intent classification matches the component behavior', () => {
  expect(detectIntent('run "ls"')).toBe('command');
  expect(detectIntent('execute tests')).toBe('command');
  expect(detectIntent('list files in src')).toBe('code_exploration');
  expect(detectIntent('what is in src/?')).toBe('code_exploration');
  expect(detectIntent('show mcp tools')).toBe('code_exploration');
  expect(detectIntent('hello')).toBe('conversation');
  expect(userQueryNeedsTools('hello')).toBe(false);
  expect(userQueryNeedsTools('read src/index.ts')).toBe(true);
});

test('tool selection is unchanged for representative prompts', () => {
  expect(names(selectToolsForQuery(tools, 'run "ls"'))).toEqual(['run_command']);
  expect(selectToolsForQuery(tools, 'hello')).toEqual([]);
  const explore = names(selectToolsForQuery(tools, 'what is in src/?'));
  expect(explore).toContain('list_files');
  expect(explore).toContain('read_file');
  expect(explore).toContain('search_code');
  expect(explore).toContain('search_tools');
  expect(explore.length).toBeLessThanOrEqual(6);
  const searchy = names(selectToolsForQuery(tools, 'find where grep is configured'));
  expect(searchy).toContain('ext__grep');
});
