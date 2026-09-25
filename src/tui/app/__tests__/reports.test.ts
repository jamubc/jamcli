import { expect, test } from 'bun:test';
import { BUILTIN_COMMANDS, findCommand, matchCommands, parseCommand, splitWords } from '../commands.js';
import { contextReport, costReport, modelReport, permissionsReport, providersReport, sessionsReport, toolsReport } from '../reports.js';
import type { ModelInfo } from '../../../core/catalog/types.js';
import type { Rule } from '../../../core/permissions/rules.js';

test('a command line splits into its name and the rest, and words keep what quotes hold', () => {
  expect(parseCommand('/Compact  keep the API notes ')).toEqual({ name: 'compact', args: 'keep the API notes' });
  expect(parseCommand('/')).toEqual({ name: '', args: '' });
  expect(parseCommand('not a command')).toBeUndefined();
  expect(splitWords(`set system_prompt "Be terse, and \\"exact\\"" --scope local`)).toEqual(['set', 'system_prompt', 'Be terse, and "exact"', '--scope', 'local']);
  expect(splitWords(`add fs --command 'npx server' --arg a\\ b ''`)).toEqual(['add', 'fs', '--command', 'npx server', '--arg', 'a b', '']);
});

test('a typed prefix lists names that start with it first, then names that contain it, and aliases count', () => {
  const names = (typed: string) => matchCommands(BUILTIN_COMMANDS, typed).map((command) => command.name);
  expect(names('/co')).toEqual(['context', 'cost', 'compact', 'commit', 'commands', 'config', 'copy']);
  expect(names('/ex')).toEqual(['export', 'exit', 'context']);
  expect(names('/qu')).toEqual(['exit']);
  expect(names('/ost')).toEqual(['cost']);
  expect(names('/')).toHaveLength(BUILTIN_COMMANDS.length);
  expect(findCommand(BUILTIN_COMMANDS, 'quit')?.name).toBe('exit');
  expect(findCommand(BUILTIN_COMMANDS, 'new')?.name).toBe('clear');
  expect(findCommand(BUILTIN_COMMANDS, 'undo')?.name).toBe('undo');
  expect(findCommand(BUILTIN_COMMANDS, 'plugins')?.name).toBe('plugins');
  expect(findCommand(BUILTIN_COMMANDS, 'workflows')?.name).toBe('workflows');
});

test('the palette reaches every command the interface has today', () => {
  const names = BUILTIN_COMMANDS.map((command) => command.name);
  for (const name of ['help', 'model', 'mode', 'permissions', 'context', 'cost', 'compact', 'clear', 'resume', 'fork', 'undo', 'rewind', 'tools', 'skills', 'commands', 'hooks', 'mcp', 'config', 'copy', 'profile', 'categories', 'doctor', 'export', 'exit']) {
    expect(names).toContain(name);
  }
  expect(new Set(names).size).toBe(names.length);
});

const info: ModelInfo = {
  provider: 'anthropic',
  model: 'claude-x',
  contextWindow: 200_000,
  maxOutput: 64_000,
  tools: true,
  reasoning: true,
  thinking: 'adaptive',
  effort: true,
  price: { input: 3, output: 15 },
  sources: { contextWindow: 'provider', maxOutput: 'bundled', price: 'config' },
};

test('the model report gives each fact with where it came from, and says when a price is unknown', () => {
  const text = modelReport(info);
  expect(text).toContain('Model: anthropic:claude-x');
  expect(text).toContain('Context window: 200,000 tokens (from the provider)');
  expect(text).toContain('Longest reply: 64,000 tokens (from the bundled table)');
  expect(text).toContain('Takes: tools, reasoning');
  expect(text).toContain('Thinking: adaptive, with an effort setting');
  expect(text).toContain('Price per million tokens: $3.00 in, $15.00 out (from the models block)');
  const unknown = modelReport({ provider: 'x', model: 'y', contextWindow: 8192, sources: { contextWindow: 'default' } });
  expect(unknown).toContain('8,192 tokens (a default, since no source knows it)');
  expect(unknown).toContain('Price: unknown, so its requests are counted as unpriced');
});

test('the context report says how full it is, where compaction starts, and when the window is a guess', () => {
  const usage = { used: 30_000, window: 128_000, budget: 100_000, trigger: 80_000, correction: 1, autoCompact: true, windowKnown: true };
  expect(contextReport(usage, 12)).toBe(
    [
      'Context: 30,000 of 100,000 tokens a request may use (30%), over 12 messages.',
      'Window: 128,000 tokens.',
      'Compaction starts at 80,000 tokens. /compact runs it now, and /compact <focus> steers the summary.',
    ].join('\n')
  );
  const guessed = contextReport({ ...usage, windowKnown: false, autoCompact: false, correction: 1.25 }, 1);
  expect(guessed).toContain('over 1 message.');
  expect(guessed).toContain('a guess: compaction waits until the provider refuses a request as too long');
  expect(guessed).toContain('Automatic compaction is off (context.auto_compact)');
  expect(guessed).toContain('scaled by 1.25');
});

test('the cost report totals by model, and a request with no price makes the total a lower bound', () => {
  expect(costReport({ cost: 0, requests: 0, unpriced: 0, models: [], delegated: { cost: 0, requests: 0, unpriced: 0 } })).toBe('No requests yet, so nothing has been spent.');
  const usage = (prompt: number, completion: number) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion });
  const text = costReport({
    cost: 0.0421,
    requests: 4,
    unpriced: 1,
    models: [
      { model: 'anthropic:claude-x', requests: 3, unpriced: 0, cost: 0.0421, usage: usage(12_000, 800) },
      { model: 'custom:thing', requests: 1, unpriced: 1, cost: 0, usage: usage(50, 5) },
    ],
    delegated: { cost: 0.01, requests: 1, unpriced: 0 },
  });
  expect(text).toContain('This session: $0.0421 or more over 4 requests.');
  expect(text).toContain('1 request had no known price and is not in the total.');
  expect(text).toContain('- anthropic:claude-x: $0.0421, 3 requests, 12k in, 800 out');
  expect(text).toContain('- custom:thing: no known price, 1 request, 50 in, 5 out');
  expect(text).toContain('Delegated work, already counted above: $0.0100 over 1 request.');
});

const rule = (decision: Rule['decision'], text: string, scope: Rule['scope'], source: string): Rule => ({ decision, text, scope, source, tool: text.split('(')[0] });

test('the permissions report lists deny, ask, then allow, each rule with its scope and source, and how to change them', () => {
  const text = permissionsReport('accept-edits', [
    rule('allow', 'run_command(cd *)', 'builtin', 'built-in'),
    rule('deny', 'run_command(rm *)', 'local', '.jamcli/config.local.json permissions.deny[0]'),
    rule('ask', 'edit(src/**)', 'session', 'added in this session'),
  ]);
  const lines = text.split('\n');
  expect(lines[0]).toStartWith('Mode: accept-edits.');
  expect(lines.indexOf('deny:')).toBeLessThan(lines.indexOf('ask:'));
  expect(lines.indexOf('ask:')).toBeLessThan(lines.indexOf('allow:'));
  expect(text).toContain('- run_command(rm *)  (project-local: .jamcli/config.local.json permissions.deny[0])');
  expect(text).toContain('- edit(src/**)  (this session: added in this session)');
  expect(text).toContain('- run_command(cd *)  (built in: built-in)');
  expect(text).toContain('/permissions allow|ask|deny <rule> [session|local|project|user]');
  expect(permissionsReport('default', [])).toContain('No rules.');
});

test('the tools report groups tools by where they come from', () => {
  const tool = (name: string, source: 'builtin' | 'mcp', server?: string) => ({ name, description: `${name} does things.\nMore.`, parameters: {}, policyClass: 'read' as const, source, ...(server ? { server } : {}) });
  const text = toolsReport([tool('read_file', 'builtin'), tool('github__issues', 'mcp', 'github')]);
  expect(text).toContain('2 tools offered to the model.');
  expect(text).toContain('Built in:\n- read_file (read): read_file does things.');
  expect(text).toContain('MCP server github:\n- github__issues (read): github__issues does things.');
});

test('the sessions report lists the latest first, marks this one, and says how old each is', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  const session = (id: string, updated: string, title?: string) => ({ id, projectRoot: '/p', projectName: 'p', created: updated, updated, totalTokens: 0, messageCount: 4, ...(title ? { title } : {}) });
  const text = sessionsReport([session('b', '2026-09-24T11:30:00Z', 'Fix the parser'), session('a', '2026-09-22T12:00:00Z')], 'b', now);
  expect(text).toContain('- b (this one): Fix the parser, 4 messages, 30 minutes ago');
  expect(text).toContain('- a: untitled, 4 messages, 2 days ago');
  expect(text).toContain('Open one with /resume <id>.');
  expect(sessionsReport([], 'x')).toBe('No earlier sessions in this project.');
});

test('the providers report says where each key comes from, and never shows one', () => {
  const text = providersReport(
    {
      ollama: { endpoint: 'http://gpu:11434', num_ctx: 32768 },
      openrouter: { key_env_var: 'OPENROUTER_API_KEY' },
      anthropic: { api_key: 'sk-ant-secret-value' },
      endpoints: [{ id: 'lab', base_url: 'https://lab.example/v1', dialect: 'anthropic', key_env_var: 'LAB_KEY' }],
    },
    { OPENROUTER_API_KEY: 'x' },
    (account) => account === 'openai'
  );
  expect(text).toContain('- ollama: http://gpu:11434, a 32,768-token window, no key needed');
  expect(text).toContain('- openrouter: the standard address, key from $OPENROUTER_API_KEY (set)');
  expect(text).toContain('- anthropic: the standard address, key written in a configuration file (hidden');
  expect(text).toContain('- openai: the standard address, key in the key store');
  expect(text).toContain('- lab: https://lab.example/v1, anthropic format, key from $LAB_KEY (not set)');
  expect(text).not.toContain('sk-ant-secret-value');
});
