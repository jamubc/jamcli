import { expect, test } from 'bun:test';
import { executeBatch, type DispatchVerdict, type ToolDispatcher } from '../dispatch.js';
import { createSession } from '../../state.js';
import type { AgentEvent, ToolCall } from '../../types.js';

const call = (name: string): ToolCall => ({ id: name, name, arguments: {} });

const dispatcher = (verdicts: Record<string, DispatchVerdict>, classes: Record<string, string> = {}): ToolDispatcher & { ran: string[] } => {
  const ran: string[] = [];
  return {
    ran,
    listTools: () => [],
    requiresApproval: () => false,
    policyClass: (name) => (classes[name] ?? 'write') as any,
    decide: (item) => verdicts[item.name] ?? { decision: 'allow' },
    execute: async (item) => {
      ran.push(item.name);
      return { tool: item.name, success: true, output: `${item.name} ran`, durationMs: 0 };
    },
  };
};

const run = async (calls: ToolCall[], target: ToolDispatcher, answer?: (event: AgentEvent) => void) => {
  const events: AgentEvent[] = [];
  const outcome = await executeBatch(calls, {
    dispatcher: target,
    emit: (event) => {
      events.push(event);
      answer?.(event);
    },
    signal: new AbortController().signal,
    projectRoot: '/tmp/verdicts',
    session: createSession('/tmp/verdicts'),
  });
  return { events, outcome };
};

test('a policy denial answers its call with the reason, and the step goes on', async () => {
  const target = dispatcher({ rm: { decision: 'deny', by: 'policy', rule: 'rm', reason: 'rm denies it (.jamcli/config.json)' } });
  const { events, outcome } = await run([call('rm'), call('build')], target);
  expect(outcome.results.map((result) => [result.status, result.output])).toEqual([
    ['denied', 'Not run: rm denies it (.jamcli/config.json).'],
    ['ok', 'build ran'],
  ]);
  expect(target.ran).toEqual(['build']);
  expect(outcome.denial).toBeUndefined();
  expect(events.find((event) => event.type === 'approval_decision')).toMatchObject({ allow: false, by: 'policy', rule: 'rm', reason: 'rm denies it (.jamcli/config.json)' });
});

test("only a person's denial takes back the rest of the step", async () => {
  const asks = dispatcher({ a: { decision: 'ask' }, b: { decision: 'ask' } });
  const byMode = await run([call('a'), call('b')], asks, (event) => {
    if (event.type === 'approval_request') event.decide(event.call.name === 'a' ? { allow: false, by: 'mode', feedback: 'cannot ask here' } : true);
  });
  expect(byMode.outcome.results.map((result) => result.status)).toEqual(['denied', 'ok']);

  const byUser = await run([call('a'), call('b')], dispatcher({ a: { decision: 'ask' }, b: { decision: 'ask' } }), (event) => {
    if (event.type === 'approval_request') event.decide(false);
  });
  expect(byUser.outcome.results.map((result) => result.status)).toEqual(['denied', 'cancelled']);
  expect(byUser.outcome.denial).toEqual({ feedback: undefined });
});

test('allowed changes are recorded with who allowed them; reads and the plan are not', async () => {
  const target = dispatcher(
    {
      edit: { decision: 'allow', by: 'flag', rule: 'edit', reason: 'edit allows it (--allow-tool edit)' },
      todo_write: { decision: 'allow', by: 'mode', reason: 'default mode allows tools that keep the plan' },
      read_file: { decision: 'allow', by: 'mode' },
    },
    { todo_write: 'state', read_file: 'read' }
  );
  const { events } = await run([call('edit'), call('todo_write'), call('read_file')], target);
  const recorded = events.filter((event) => event.type === 'approval_decision');
  expect(recorded).toEqual([
    { type: 'approval_decision', callId: 'edit', tool: 'edit', allow: true, scope: 'once', by: 'flag', rule: 'edit', reason: 'edit allows it (--allow-tool edit)' },
  ]);
});
