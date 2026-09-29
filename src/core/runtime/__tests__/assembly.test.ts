import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { configuredSecrets, resolveModel } from '../model.js';
import { createToolSet, registerMcpTools, type McpSource } from '../tools.js';
import { sessionPermissions } from '../permissions.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { PermissionFlags } from '../../permissions/config.js';
import { expandReferences } from '../references.js';
import { buildRuntimePrompt } from '../prompt.js';
import { createBuiltinRegistry } from '../../tools/registry.js';
import type { McpToolDescriptor } from '../../../types/mcp.js';

test('a model id with its own colon stays whole on the profile provider', () => {
  const profile = { name: 'p', preferred_provider: 'ollama' as const, preferred_model: 'llama3' };
  expect(resolveModel('qwen2.5-coder:7b', profile)).toEqual({ provider: 'ollama', model: 'qwen2.5-coder:7b' });
  expect(resolveModel('ollama:qwen2.5-coder:7b', profile)).toEqual({ provider: 'ollama', model: 'qwen2.5-coder:7b' });
  expect(resolveModel('openrouter:anthropic/claude', profile)).toEqual({ provider: 'openrouter', model: 'anthropic/claude' });
  expect(resolveModel('lab:m', profile, { endpoints: [{ id: 'lab', base_url: 'http://x' }] })).toEqual({ provider: 'lab', model: 'm' });
  expect(resolveModel(undefined, profile)).toEqual({ provider: 'ollama', model: 'llama3' });
  expect(resolveModel(undefined, { name: 'p' })).toEqual({ provider: 'ollama', model: '' });
});

test('configured keys, key variables, and auth headers are known secrets', () => {
  const secrets = configuredSecrets(
    {
      openai: { api_key: 'sk-configured-1234' },
      openrouter: { key_env_var: 'MY_ROUTER' },
      endpoints: [{ id: 'lab', base_url: 'http://x', headers: { Authorization: 'Bearer lab-token-5678' } }],
    },
    { MY_ROUTER: 'or-value-abcdefgh' }
  );
  expect(secrets).toEqual([
    { name: 'MY_ROUTER', value: 'or-value-abcdefgh' },
    { name: 'config:openai', value: 'sk-configured-1234' },
    { name: 'config:lab.headers.Authorization', value: 'lab-token-5678' },
  ]);
});

const engineFor = (registry: ToolRegistry, flags: PermissionFlags = {}, legacyTools?: Record<string, any>) =>
  sessionPermissions({ projectRoot: os.tmpdir(), registry, flags, legacyTools, sandboxed: false, env: {} }).engine;

const descriptor = (name: string, annotations?: McpToolDescriptor['annotations']): McpToolDescriptor => ({
  name: `srv__${name}`,
  nativeName: name,
  description: `${name} tool`,
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  source: 'server',
  serverId: 'srv',
  annotations,
});

const fakeMcp = (calls: string[] = []): McpSource => ({
  listServers: async () => [
    { id: 'srv', command: 'x' },
    { id: 'broken', command: 'y' },
    { id: 'off', command: 'z', enabled: false },
  ],
  listServerTools: async (server) => {
    if (server.id === 'broken') throw new Error('spawn failed');
    return [descriptor('lookup', { readOnlyHint: true }), descriptor('deploy')];
  },
  callServerTool: async (tool, args) => {
    calls.push(`${tool.nativeName}:${args.q}`);
    return { output: `${tool.nativeName} said ${args.q}` };
  },
});

test('MCP tools run through the same registry, schemas, and policy as built-ins', async () => {
  const calls: string[] = [];
  const registry = createBuiltinRegistry();
  const notices: string[] = [];
  const servers = await registerMcpTools(registry, fakeMcp(calls), notices);
  expect(notices).toEqual(['MCP server broken is unavailable: spawn failed']);
  const set = createToolSet({ registry, mcpServers: servers, permissions: engineFor(registry), context: () => ({ projectRoot: os.tmpdir() }) });

  // A server's read-only annotation is its own claim, so the tool asks like any other until a rule allows it.
  expect(set.summaries.find((tool) => tool.name === 'srv__lookup')).toMatchObject({ source: 'mcp', server: 'srv', policyClass: 'execute' });
  expect(set.dispatcher.requiresApproval('srv__lookup')).toBe(true);
  expect(set.dispatcher.requiresApproval('srv__deploy')).toBe(true);

  const result = await set.dispatcher.execute({ id: 'c', name: 'srv__lookup', arguments: { q: 'hi' } });
  expect(result).toMatchObject({ success: true, output: 'lookup said hi' });
  const invalid = await set.dispatcher.execute({ id: 'd', name: 'srv__lookup', arguments: {} });
  expect(invalid.success).toBe(false);
  expect(calls).toEqual(['lookup:hi']);
});

test('settings and flags for an old tool name apply to the tool that replaced it', () => {
  const registry = createBuiltinRegistry();
  const permissions = engineFor(registry, { denyTools: ['search_code'] }, { list_files: false });
  const set = createToolSet({ registry, permissions, context: () => ({ projectRoot: os.tmpdir() }) });
  const names = set.summaries.map((tool) => tool.name);
  expect(names).not.toContain('glob');
  expect(names).not.toContain('grep');
  expect(names).toContain('read_file');
});

test('every decision says who made it and why', () => {
  const registry = createBuiltinRegistry();
  const set = createToolSet({ registry, permissions: engineFor(registry, { allowTools: ['edit'] }), context: () => ({ projectRoot: os.tmpdir() }) });
  expect(set.dispatcher.decide!({ id: 'a', name: 'edit', arguments: { path: 'a.ts' } })).toEqual({
    decision: 'allow',
    by: 'flag',
    rule: 'edit',
    reason: 'edit allows it (--allow-tool edit)',
  });
  expect(set.dispatcher.decide!({ id: 'b', name: 'read_file', arguments: { path: 'a.ts' } })).toMatchObject({ decision: 'allow', by: 'mode' });
  expect(set.dispatcher.decide!({ id: 'c', name: 'run_command', arguments: { command: 'make' } })).toEqual({
    decision: 'ask',
    by: 'mode',
    reason: 'default mode asks before tools that run commands',
  });
});

test('a binary file is not expanded as a reference', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-ref-'));
  try {
    fs.writeFileSync(path.join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const expanded = await expandReferences('look at @image.png', dir, (text) => text);
    expect(expanded.prompt).toBe('look at @image.png');
    expect(expanded.notices).toEqual(['Did not include @image.png: it is a binary file.']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tool guidance names only the tools that are offered', () => {
  const only = (names: string[]) =>
    buildRuntimePrompt({
      tools: names.map((name) => ({ name, description: '', parameters: {}, policyClass: 'read', source: 'builtin' })),
      projectRoot: '/p',
      cwd: '/p',
      date: new Date(2026, 8, 23, 12),
      platform: 'linux',
    });
  expect(only(['read_file'])).not.toContain('run_command');
  expect(only(['read_file', 'run_command'])).toContain('run_command');
  expect(only([])).not.toContain('Working with tools');
  expect(only([])).toContain('- Date: 2026-09-23');
});

test('the plan note describes the harness and names only the plan tools that are offered', () => {
  const inPlan = (names: string[]) =>
    buildRuntimePrompt({
      tools: names.map((name) => ({ name, description: '', parameters: {}, policyClass: 'read', source: 'builtin' })),
      projectRoot: '/p',
      cwd: '/p',
      mode: 'plan',
    });
  const full = inPlan(['read_file', 'plan_write', 'plan_read', 'exit_plan_mode', 'ask_user', 'todo_write']);
  expect(full).toContain('Plan mode is on.');
  expect(full).toContain('plan_write saves the plan to .jamcli/plan.md');
  expect(full).toContain('Ask the person with ask_user about');
  expect(full).toContain('5. Put the steps into the todo list with todo_write');
  expect(full).toContain('6. Then call exit_plan_mode.');
  expect(full).toContain('code that exists is not a step done');
  const bare = inPlan(['read_file']);
  expect(bare).toContain('Plan mode is on.');
  expect(bare).not.toContain('plan_write');
  expect(bare).toContain('by ending your turn with the question');
  expect(bare).toContain('4. Present the plan in your reply');
  expect(bare).toContain('5. Then stop. The person approves by switching the mode');
  expect(bare).not.toContain('todo_write');
  expect(buildRuntimePrompt({ tools: [], projectRoot: '/p', cwd: '/p', mode: 'default' })).not.toContain('Plan mode is on');
});

test("the date is the person's local date, not the UTC one", () => {
  const zone = process.env.TZ;
  const dateIn = (tz: string, date: Date) => {
    process.env.TZ = tz;
    try {
      return buildRuntimePrompt({ tools: [], projectRoot: '/p', cwd: '/p', date, platform: 'linux' }).match(/- Date: (.+)/)?.[1];
    } finally {
      process.env.TZ = zone;
    }
  };
  // Evening in California is already tomorrow in UTC, and morning in Tokyo still yesterday.
  expect(dateIn('America/Los_Angeles', new Date('2026-09-28T03:30:00Z'))).toBe('2026-09-27');
  expect(dateIn('Asia/Tokyo', new Date('2026-09-27T16:30:00Z'))).toBe('2026-09-28');
});
