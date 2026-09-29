import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
import { createHookBus } from '../hooks/index.js';
import { createScriptedProvider } from '../../testing/scriptedProvider.js';
import type { ChatProvider, CompletionResult } from '../providers/types.js';
import type { ToolDispatcher } from '../tools/dispatch.js';
import type { AgentEvent, ToolResult } from '../types.js';

const readFileDispatcher = (output = 'contents', executed: string[] = []): ToolDispatcher => ({
  listTools: () => [{ name: 'read_file' }],
  requiresApproval: () => false,
  isReadOnly: () => true,
  async execute(call): Promise<ToolResult> {
    executed.push(call.name);
    return { tool: call.name, success: true, output, durationMs: 1 };
  },
});

const readFileTool = [{ type: 'function' as const, function: { name: 'read_file' } }];
const readCallThen = (final: string) =>
  createScriptedProvider([{ toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'a.md' } }] }, { text: final }]);

test('a full turn runs headless with no UI module in the core', async () => {
  const provider = createScriptedProvider([
    { usage: { prompt: 10, completion: 2 }, toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'README.md' } }] },
    { text: 'README.md starts with the project summary.', usage: { prompt: 20, completion: 8 } },
  ]);
  const executed: string[] = [];
  const agent = new CoreAgent({ provider, dispatcher: readFileDispatcher('# JamCLI', executed), toolDefinitions: readFileTool, model: 'm', modelUsageKey: 'test:stub' });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession('/tmp/headless-project', 'headless-test'), 'Summarize the README.', (e) => events.push(e));

  expect(result.status).toBe('ok');
  expect(result.response).toBe('README.md starts with the project summary.');
  expect(executed).toEqual(['read_file']);
  expect(result.turns).toBe(2);
  expect(result.usage.total_tokens).toBe(40);
  expect(events.filter((e) => e.type === 'usage')).toHaveLength(2);

  const coreDir = new URL('..', import.meta.url).pathname;
  const coreFiles = Array.from(new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: coreDir }));
  const importingUi = coreFiles.filter((file) => {
    const source = readFileSync(`${coreDir}${file}`, 'utf8');
    return /from ['"](ink|react|@opentui\/[a-z]+)['"]/.test(source);
  });
  expect(importingUi).toEqual([]);
});

test('the hook bus sees the turn, the tool, and the result in order', async () => {
  const seen: string[] = [];
  const hooks = createHookBus();
  hooks.on('turn_start', () => seen.push('turn_start'));
  hooks.on('pre_tool', (payload) => seen.push(`pre_tool:${payload.call.name}`));
  hooks.on('post_tool', (payload) => seen.push(`post_tool:${payload.result.tool}`));
  const agent = new CoreAgent({ provider: readCallThen('done'), dispatcher: readFileDispatcher(), toolDefinitions: readFileTool, hooks, model: 'm' });
  await agent.run(createSession('/tmp/hook-project', 'hook-run'), 'read it', () => {});
  expect(seen).toEqual(['turn_start', 'pre_tool:read_file', 'post_tool:read_file']);
});

test('a throwing hook becomes a notice, never answer text, and the turn finishes (F25)', async () => {
  const hooks = createHookBus();
  hooks.on('turn_start', () => {
    throw new Error('hook exploded');
  }, 'explosive');
  const agent = new CoreAgent({ provider: createScriptedProvider([{ text: 'fine' }]), hooks, model: 'm' });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession('/tmp/hook-project', 'hook-fail'), 'hello', (e) => events.push(e));
  expect(result.status).toBe('ok');
  expect(result.response).toBe('fine');
  expect(hooks.failures()).toEqual([{ event: 'turn_start', handler: 'explosive', message: 'hook exploded' }]);
  const notice = events.find((e) => e.type === 'notice') as any;
  expect(notice).toMatchObject({ level: 'warn', code: 'hook_failed' });
  expect(notice.message).toContain('hook exploded');
  expect(events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('')).toBe('fine');
});
