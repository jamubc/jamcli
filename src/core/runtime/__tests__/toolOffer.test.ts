import { expect, test } from 'bun:test';
import { ToolOffer } from '../offer.js';
import type { ToolSet } from '../tools.js';
import { createBuiltinRegistry } from '../../tools/registry.js';

const registry = createBuiltinRegistry();
const tool = (name: string, server?: string) => ({ name, description: `${name} does it`, parameters: { type: 'object' }, policyClass: 'read' as const, source: server ? ('mcp' as const) : ('builtin' as const), ...(server ? { server } : {}) });
const toolSet = (names: string[], mcp: [string, string][] = []): ToolSet =>
  ({
    registry,
    summaries: [...names.map((name) => tool(name)), ...mcp.map(([name, server]) => tool(name, server))],
    definitions: names.filter((name) => registry.get(name)?.tier === 'core').map((name) => ({ type: 'function', function: { name, description: '', parameters: {} } })),
  }) as unknown as ToolSet;

test('the task family waits until a task starts, then joins the running turn', () => {
  const set = toolSet(['read_file', 'task', 'task_status', 'task_result']);
  const offer = new ToolOffer({ registry, searchThreshold: 0, toolSet: () => set });
  expect(offer.deferred('task_status')).toBe(true);
  expect(offer.deferred('task')).toBe(false);
  offer.afterCall('read_file');
  expect(offer.deferred('task_status')).toBe(true);
  offer.afterCall('task');
  expect(offer.deferred('task_status')).toBe(false);
  expect(set.definitions.map((definition) => definition.function.name)).toContain('task_result');
});

test('MCP tools past the threshold wait behind search_tools until loaded', () => {
  const set = toolSet(['read_file'], [['docs_search', 'docs'], ['docs_read', 'docs']]);
  const servers = new Map([['docs_search', 'docs'], ['docs_read', 'docs']]);
  const offer = new ToolOffer({ registry, mcpServers: servers, searchThreshold: 1, toolSet: () => set });
  expect(offer.searchList()).toEqual([
    { name: 'docs_search', description: 'docs_search does it', server: 'docs' },
    { name: 'docs_read', description: 'docs_read does it', server: 'docs' },
  ]);
  offer.load(['docs_read']);
  expect(offer.searchable('docs_read')).toBe(false);
  expect(offer.searchList().map((entry) => entry.name)).toEqual(['docs_search']);
  expect(set.definitions.map((definition) => definition.function.name)).toContain('docs_read');
  expect(new ToolOffer({ registry, mcpServers: servers, searchThreshold: 2, toolSet: () => set }).searchable('docs_search')).toBe(false);
});

test('the extended tier is held back when a known window has no room for it, never on a guess', () => {
  const extended = registry.list().find((entry) => entry.tier !== 'core' && !entry.hidden && !entry.aliasOf)!.name;
  const set = toolSet(['read_file', extended]);
  const offer = new ToolOffer({ registry, searchThreshold: 0, toolSet: () => set });
  const tight = { budget: 1_000, outputReserve: 800 };
  expect(offer.decideTiers('a prompt', tight, false)).toBe(false);
  expect(offer.searchable(extended)).toBe(false);
  expect(offer.decideTiers('a prompt', tight, true)).toBe(true);
  expect(offer.searchable(extended)).toBe(true);
  expect(offer.searchable('read_file')).toBe(false);
  expect(offer.decideTiers('a prompt', { budget: 100_000, outputReserve: 800 }, true)).toBe(true);
  expect(offer.searchable(extended)).toBe(false);
});
