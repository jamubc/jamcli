import { expect, test } from 'bun:test';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
import { createScriptedProvider } from '../../testing/scriptedProvider.js';
import type { ToolDispatcher } from '../tools/dispatch.js';
import type { AgentEvent, ToolCall, ToolResult } from '../types.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../../types/config.js';

const project = '/tmp/engine-project';

/** A dispatcher over fake tools. `read_*` tools are read-only; anything in `ask` needs approval. */
const fakeDispatcher = (options: { ask?: string[]; delayMs?: number; log?: string[] } = {}): ToolDispatcher => ({
  listTools: () => [],
  requiresApproval: (name) => (options.ask ?? []).includes(name),
  isReadOnly: (name) => name.startsWith('read'),
  async execute(call: ToolCall): Promise<ToolResult> {
    options.log?.push(`start:${call.name}`);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    options.log?.push(`end:${call.name}`);
    return { tool: call.name, success: true, output: `${call.name} output`, durationMs: 1 };
  },
});

const toolDefs = (...names: string[]) => names.map((name) => ({ type: 'function' as const, function: { name } }));
const types = (events: AgentEvent[]) => events.map((event) => event.type);

test('a run with no provider reports an error instead of echoing the prompt', async () => {
  const events: AgentEvent[] = [];
  const result = await new CoreAgent().run(createSession(project), 'hello', (e) => events.push(e));
  expect(result.status).toBe('error');
  expect(result.error).toContain('No model provider');
  expect(events.some((event) => event.type === 'text')).toBe(false);
});

test('a reply streams text and reasoning and reports usage', async () => {
  const provider = createScriptedProvider([{ reasoning: 'greet', text: 'hello there', usage: { prompt: 3, completion: 2 } }]);
  const events: AgentEvent[] = [];
  const result = await new CoreAgent({ provider, model: 'm', modelUsageKey: 'fake:m' }).run(
    createSession(project),
    'hi',
    (e) => events.push(e)
  );
  expect(result.status).toBe('ok');
  expect(result.response).toBe('hello there');
  expect(result.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(1);
  expect(types(events)[0]).toBe('turn_start');
  expect(types(events).at(-1)).toBe('turn_end');
  expect(result.session?.modelUsage['fake:m'].total_tokens).toBe(5);
});

test('the system prompt comes first and text beside a tool call is kept (F7)', async () => {
  const provider = createScriptedProvider([
    { text: 'Let me check.', reasoning: 'need the file', toolCalls: [{ name: 'read_file', arguments: { path: 'a' } }] },
    { text: 'It says hello.' },
  ]);
  const agent = new CoreAgent({
    provider,
    model: 'm',
    systemPrompt: 'SYSTEM',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file'),
  });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession(project), 'read a', (e) => events.push(e));

  expect(result.status).toBe('ok');
  for (const call of provider.calls) {
    expect(call.messages[0]).toMatchObject({ role: 'system', content: 'SYSTEM' });
    expect(call.options.tools?.[0].function.name).toBe('read_file');
  }
  const second = provider.calls[1].messages;
  expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
  expect(second[2]).toMatchObject({ content: 'Let me check.', reasoning: 'need the file' });
  expect(second[2].tool_calls?.[0].function.name).toBe('read_file');
  expect(second[3]).toMatchObject({ role: 'tool', content: 'read_file output', tool_call_id: second[2].tool_calls?.[0].id });
  expect(events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('')).toBe('Let me check.It says hello.');
  expect(result.session?.messages.some((m) => m.role === 'system')).toBe(false);
});

test('every call in a batch is answered around an approval (F8)', async () => {
  const provider = createScriptedProvider([
    {
      toolCalls: [
        { name: 'read_a', arguments: {} },
        { name: 'write_b', arguments: { path: 'b' } },
        { name: 'read_c', arguments: {} },
      ],
    },
    { text: 'done' },
  ]);
  const log: string[] = [];
  const agent = new CoreAgent({
    provider,
    dispatcher: fakeDispatcher({ ask: ['write_b'], log }),
    toolDefinitions: toolDefs('read_a', 'write_b', 'read_c'),
    model: 'm',
  });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession(project), 'go', (e) => {
    events.push(e);
    if (e.type === 'approval_request') e.decide(true);
  });
  expect(result.status).toBe('ok');
  expect(log.filter((entry) => entry.startsWith('start'))).toEqual(['start:read_a', 'start:write_b', 'start:read_c']);
  const toolMessages = provider.calls[1].messages.filter((m) => m.role === 'tool');
  expect(toolMessages).toHaveLength(3);
  const request = events.find((e) => e.type === 'approval_request') as any;
  expect(request.request.summary).toBe('write_b b');
});

test('a denial without feedback answers the rest of the batch and ends the turn', async () => {
  const provider = createScriptedProvider([
    { text: 'Trying.', toolCalls: [{ name: 'write_a', arguments: {} }, { name: 'read_b', arguments: {} }] },
  ]);
  const log: string[] = [];
  const agent = new CoreAgent({ provider, dispatcher: fakeDispatcher({ ask: ['write_a'], log }), toolDefinitions: toolDefs('write_a', 'read_b'), model: 'm' });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession(project), 'go', (e) => {
    events.push(e);
    if (e.type === 'approval_request') e.decide(false);
  });
  expect(result.status).toBe('refused');
  expect(log).toEqual([]);
  const results = events.filter((e) => e.type === 'tool_result').map((e: any) => e.result);
  expect(results.map((r) => r.status)).toEqual(['denied', 'cancelled']);
  const toolMessages = result.session!.messages.filter((m) => m.role === 'tool');
  expect(toolMessages.map((m) => m.content)).toEqual([
    'Denied by the user. The call did not run.',
    'Not run: an earlier call in this step was denied.',
  ]);
});

test('a denial with feedback is given to the model and the turn continues', async () => {
  const provider = createScriptedProvider([{ toolCalls: [{ name: 'write_a', arguments: {} }] }, { text: 'Understood, I will not.' }]);
  const agent = new CoreAgent({ provider, dispatcher: fakeDispatcher({ ask: ['write_a'] }), toolDefinitions: toolDefs('write_a'), model: 'm' });
  const result = await agent.run(createSession(project), 'go', (e) => {
    if (e.type === 'approval_request') e.decide({ allow: false, feedback: 'use the other file' });
  });
  expect(result.status).toBe('ok');
  expect(provider.calls[1].messages.at(-1)).toMatchObject({ role: 'tool', content: 'Denied by the user, who said: use the other file' });
});

test('a read, search, edit, and test cycle finishes under the default limits (F9)', async () => {
  const steps = [
    ['read_file'],
    ['read_grep', 'read_glob'],
    ['read_file'],
    ['edit'],
    ['run_command'],
    ['read_file'],
    ['edit'],
    ['run_command'],
  ];
  const provider = createScriptedProvider([
    ...steps.map((names) => ({ toolCalls: names.map((name) => ({ name, arguments: {} })) })),
    { text: 'Fixed and tests pass.' },
  ]);
  const agent = new CoreAgent({
    provider,
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file', 'read_grep', 'read_glob', 'edit', 'run_command'),
    model: 'm',
  });
  const result = await agent.run(createSession(project), 'fix the bug', () => {});
  expect(result.status).toBe('ok');
  expect(result.turns).toBe(9);
  expect(DEFAULT_AGENT_LOOP_CONFIG).toMatchObject({ max_steps: 50, max_tool_calls_per_turn: 0, tool_result_max_chars: 30_000 });
});

test('consecutive read-only calls run concurrently', async () => {
  const provider = createScriptedProvider([
    { toolCalls: [{ name: 'read_a', arguments: {} }, { name: 'read_b', arguments: {} }] },
    { text: 'ok' },
  ]);
  const log: string[] = [];
  const agent = new CoreAgent({ provider, dispatcher: fakeDispatcher({ delayMs: 30, log }), toolDefinitions: toolDefs('read_a', 'read_b'), model: 'm' });
  await agent.run(createSession(project), 'go', () => {});
  expect(log.slice(0, 2)).toEqual(['start:read_a', 'start:read_b']);
});

test('the per-turn cap answers capped calls and stops when nothing can run', async () => {
  const pair = { toolCalls: [{ name: 'read_a', arguments: {} }, { name: 'read_b', arguments: {} }] };
  const provider = createScriptedProvider([pair, pair]);
  const agent = new CoreAgent({ provider, dispatcher: fakeDispatcher(), toolDefinitions: toolDefs('read_a', 'read_b'), model: 'm', maxToolCallsPerTurn: 1 });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession(project), 'go', (e) => events.push(e));
  expect(result.status).toBe('limit');
  expect(provider.calls).toHaveLength(2);
  const statuses = events.filter((e) => e.type === 'tool_result').map((e: any) => e.result.status);
  expect(statuses).toEqual(['ok', 'cancelled', 'cancelled', 'cancelled']);
});

test('the step limit stops a turn that never finishes', async () => {
  const provider = createScriptedProvider(Array.from({ length: 5 }, () => ({ toolCalls: [{ name: 'read_a', arguments: {} }] })));
  const agent = new CoreAgent({ provider, dispatcher: fakeDispatcher(), toolDefinitions: toolDefs('read_a'), model: 'm', maxSteps: 3 });
  const result = await agent.run(createSession(project), 'go', () => {});
  expect(result.status).toBe('limit');
  expect(result.response).toContain('Stopped after 3 steps');
});

test('cancel aborts a streaming turn, keeps the partial text, and the session stays usable', async () => {
  const provider = createScriptedProvider([{ text: 'a long answer that streams slowly', chunkSize: 2, delayMs: 20 }, { text: 'again' }]);
  const agent = new CoreAgent({ provider, model: 'm' });
  const session = createSession(project);
  const pending = agent.run(session, 'go', () => {});
  setTimeout(() => agent.cancel(session.id), 60);
  const cancelled = await pending;
  expect(cancelled.status).toBe('cancelled');
  const partial = cancelled.session!.messages.at(-1)!;
  expect(partial.role).toBe('assistant');
  expect(partial.content.length).toBeGreaterThan(0);
  const again = await agent.run(cancelled.session!, 'try again', () => {});
  expect(again.status).toBe('ok');
});

test('the returned session carries the conversation into the next prompt', async () => {
  const provider = createScriptedProvider([{ text: 'first answer' }, { text: 'second answer' }]);
  const agent = new CoreAgent({ provider, model: 'm' });
  const first = await agent.run(createSession(project), 'first question', () => {});
  await agent.run(first.session!, 'second question', () => {});
  expect(provider.calls[1].messages.map((m) => m.content)).toEqual(['first question', 'first answer', 'second question']);
});

test('long tool output keeps its beginning and end', async () => {
  const agent = new CoreAgent({ truncationLimit: 20 });
  const cut = agent.truncate(`${'a'.repeat(50)}${'z'.repeat(50)}`);
  expect(cut.startsWith('aaaaaaaaaa')).toBe(true);
  expect(cut.endsWith('zzzzzzzzzz')).toBe(true);
  expect(cut).toContain('[80 characters removed]');
});

test('provider retries surface as events', async () => {
  const provider = createScriptedProvider([{ text: 'ok' }]);
  const retrying = {
    ...provider,
    family: provider.family,
    async *streamChat(messages: any, options: any) {
      options.onRetry?.({ attempt: 1, delayMs: 5, reason: '429 slow down' });
      yield* provider.streamChat(messages, options);
    },
  };
  const events: AgentEvent[] = [];
  await new CoreAgent({ provider: retrying, model: 'm' }).run(createSession(project), 'hi', (e) => events.push(e));
  expect(events.find((e) => e.type === 'retry')).toEqual({ type: 'retry', attempt: 1, delayMs: 5, reason: '429 slow down' });
});

test('assistant messages record the provider family and signed reasoning', async () => {
  const provider = createScriptedProvider([{ text: 'x', reasoning: 'r', reasoningSignature: 'sig' }], 'anthropic');
  const result = await new CoreAgent({ provider, model: 'm' }).run(createSession(project), 'hi', () => {});
  expect(result.session!.messages.at(-1)).toMatchObject({
    providerFamily: 'anthropic',
    reasoningBlocks: [{ type: 'thinking', text: 'r', signature: 'sig' }],
  });
});
