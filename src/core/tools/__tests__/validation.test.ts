import { test, expect } from 'bun:test';
import { createToolRegistry } from '../registry.js';
import { createSession } from '../../state.js';
import { executeBatch } from '../dispatch.js';
import type { ToolContext } from '../../../types/tools.js';
import type { ToolCall } from '../../../core/types.js';

const ctx: ToolContext = { projectRoot: process.cwd() };

const registerProbe = (registry: ReturnType<typeof createToolRegistry>, runs: { count: number }) => {
  registry.register({
    name: 'probe',
    description: 'Probe tool used to exercise schema validation.',
    policy: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number of items to return.' },
      },
      required: ['limit'],
      additionalProperties: false,
    },
    runner: async () => {
      runs.count += 1;
      return { output: 'probe ran' };
    },
  });
};

test('a wrong argument type is rejected before the runner executes', async () => {
  const registry = createToolRegistry();
  const runs = { count: 0 };
  registerProbe(registry, runs);

  const result = await registry.execute('probe', { limit: 'twelve' }, ctx);

  expect(result.success).toBe(false);
  expect(result.output).toContain('limit');
  expect(runs.count).toBe(0);
});

test('a schema failure returns a tool error and the turn continues', async () => {
  const registry = createToolRegistry();
  const runs = { count: 0 };
  registerProbe(registry, runs);
  registry.register({
    name: 'probe_ok',
    description: 'A valid follow-up tool.',
    policy: 'read',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    runner: async () => ({ output: 'second tool ran' }),
  });

  const calls: ToolCall[] = [
    { id: 'call_1', name: 'probe', arguments: { limit: 'twelve' } },
    { id: 'call_2', name: 'probe_ok', arguments: {} },
  ];
  const seenResults: string[] = [];

  const outcome = await executeBatch(calls, {
    dispatcher: {
      listTools: () => registry.list().map((tool) => ({ name: tool.name })),
      requiresApproval: () => false,
      execute: (call) => registry.execute(call.name, call.arguments ?? {}, ctx),
    },
    emit: (event) => {
      if (event.type === 'tool_result') {
        seenResults.push(event.result.output);
      }
    },
    signal: new AbortController().signal,
    projectRoot: ctx.projectRoot,
    session: createSession(ctx.projectRoot),
  });

  expect(outcome.ran).toBe(2);
  expect(outcome.results).toHaveLength(2);
  expect(outcome.results[0].success).toBe(false);
  expect(outcome.results[0].output).toContain('limit');
  expect(outcome.results[1].success).toBe(true);
  expect(outcome.results[1].output).toBe('second tool ran');
  expect(seenResults).toHaveLength(2);
  expect(runs.count).toBe(0);
});
