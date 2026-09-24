import { expect, test } from 'bun:test';
import { OUTPUT_TAIL_LINES, initialView, reduceView, tail, type Row, type ViewAction, type ViewState } from '../view.js';
import type { AgentEvent, ChatMessage } from '../../../core/types.js';

const run = (actions: ViewAction[], from: ViewState = initialView({ model: 'ollama:qwen', mode: 'default', sandbox: 'bwrap' })) => actions.reduce(reduceView, from);
const event = (value: AgentEvent): ViewAction => ({ type: 'event', event: value });
const kinds = (state: ViewState) => state.rows.map((row) => row.kind);
const tool = (state: ViewState, callId: string) => state.rows.find((row) => row.kind === 'tool' && row.callId === callId) as Extract<Row, { kind: 'tool' }>;
const call = (id: string, name = 'read_file', args: Record<string, unknown> = { path: 'a.txt' }) => ({ id, name, arguments: args });

test('a turn streams into one assistant row, and a tool call closes it and opens a block', () => {
  const state = run([
    { type: 'submit', text: 'read a.txt @src' },
    event({ type: 'turn_start', prompt: 'read a.txt <expanded>' }),
    event({ type: 'reasoning', delta: 'I should ' }),
    event({ type: 'reasoning', delta: 'read it.' }),
    event({ type: 'text', delta: 'Reading ' }),
    event({ type: 'text', delta: 'now.' }),
    event({ type: 'tool_call', call: call('c1') }),
    event({ type: 'tool_progress', callId: 'c1', tool: 'read_file', chunk: 'line one\n' }),
    event({ type: 'tool_result', result: { tool: 'read_file', success: true, output: 'line one\nline two', durationMs: 12, callId: 'c1', status: 'ok' } }),
    event({ type: 'text', delta: 'It has two lines.' }),
    event({ type: 'turn_end', status: 'ok' }),
  ]);
  expect(kinds(state)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  // The person's words are shown as typed, not as expanded for the model.
  expect(state.rows[0]).toMatchObject({ kind: 'user', text: 'read a.txt @src' });
  expect(state.rows[1]).toMatchObject({ text: 'Reading now.', reasoning: 'I should read it.', streaming: false });
  expect(tool(state, 'c1')).toMatchObject({ summary: 'read_file a.txt', phase: 'ok', durationMs: 12, output: 'line one\nline two', collapsed: true });
  expect(state.rows[3]).toMatchObject({ text: 'It has two lines.', streaming: false });
  expect(state).toMatchObject({ running: false, status: { phase: 'idle' } });
  expect(new Set(state.rows.map((row) => row.id)).size).toBe(4);
});

test('an approval request queues the prompt, and the decision settles it', () => {
  const decide = () => undefined;
  const request = {
    id: 'c2',
    call: call('c2', 'run_command', { command: 'npm test' }),
    policyClass: 'execute' as const,
    summary: 'run_command npm test',
    preview: { kind: 'command' as const, text: 'npm test' },
    reason: 'default mode asks before commands',
    suggestions: ['run_command(npm test)', 'run_command(npm *)'],
  };
  let state = run([
    event({ type: 'tool_call', call: request.call }),
    event({ type: 'approval_request', call: request.call, decide, request }),
    event({ type: 'approval_request', call: call('c3', 'write_file'), decide }),
  ]);
  expect(state.approvals.map((approval) => approval.callId)).toEqual(['c2', 'c3']);
  expect(state.approvals[0]).toEqual({
    callId: 'c2',
    tool: 'run_command',
    summary: 'run_command npm test',
    reason: 'default mode asks before commands',
    preview: { kind: 'command', text: 'npm test' },
    suggestions: ['run_command(npm test)', 'run_command(npm *)'],
  });
  // A request for a call not yet shown opens its block.
  expect(tool(state, 'c3')).toMatchObject({ phase: 'waiting', summary: 'write_file a.txt' });
  expect(state.status.phase).toBe('waiting');
  // The prompt holds nothing that cannot be compared: the decide callback stays with the caller.
  expect(JSON.stringify(state.approvals)).not.toContain('decide');

  state = run(
    [
      event({ type: 'approval_decision', callId: 'c2', tool: 'run_command', allow: true, scope: 'session', by: 'user', rule: 'run_command(npm test)' }),
      event({ type: 'approval_decision', callId: 'c3', tool: 'write_file', allow: false, scope: 'once', by: 'user', feedback: 'not now' }),
    ],
    state
  );
  expect(state.approvals).toEqual([]);
  expect(tool(state, 'c2')).toMatchObject({ phase: 'running', decision: { allow: true, by: 'user', scope: 'session', rule: 'run_command(npm test)' } });
  expect(tool(state, 'c3')).toMatchObject({ phase: 'denied', decision: { allow: false } });
});

test('the status line counts tokens and cost, keeps unpriced requests apart, and shows a retry', () => {
  const state = run([
    event({ type: 'usage', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, model: 'anthropic:claude-x', cost: 0.01 }),
    event({ type: 'usage', usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 }, model: 'ollama:qwen' }),
    event({ type: 'retry', attempt: 2, delayMs: 1500, reason: '429 rate limited' }),
    { type: 'status', patch: { contextPercent: 42 } },
  ]);
  expect(state.status).toMatchObject({ costUsd: 0.01, unpriced: 1, inputTokens: 150, outputTokens: 25, contextPercent: 42, phase: 'retrying', retry: { attempt: 2 } });
  expect(run([event({ type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })]).status.costUsd).toBeNull();
  // The next token clears the retry, whether it starts a reply or continues one.
  expect(reduceView(state, event({ type: 'text', delta: 'x' })).status).toMatchObject({ phase: 'streaming', retry: undefined });
  const midway = run([event({ type: 'text', delta: 'half' }), event({ type: 'retry', attempt: 1, delayMs: 10, reason: 'reset' })]);
  expect(reduceView(midway, event({ type: 'text', delta: ' more' })).status.retry).toBeUndefined();
});

test('notices, compactions, and a turn cut short are shown, and nothing open survives the end', () => {
  const state = run([
    event({ type: 'text', delta: 'partial' }),
    event({ type: 'notice', level: 'warn', message: 'The model declined this request.' }),
    event({ type: 'compaction', beforeTokens: 9000, afterTokens: 2000, strategy: 'summary', replaced: 10, summary: 's', trigger: 'auto' }),
    event({ type: 'tool_call', call: call('c4') }),
    event({ type: 'approval_request', call: call('c4'), decide: () => undefined }),
    event({ type: 'turn_end', status: 'cancelled' }),
  ]);
  expect(kinds(state)).toEqual(['assistant', 'notice', 'compaction', 'tool']);
  expect(state.rows[0]).toMatchObject({ streaming: false });
  expect(state.rows[2]).toMatchObject({ beforeTokens: 9000, afterTokens: 2000, trigger: 'auto' });
  expect(tool(state, 'c4').phase).toBe('cancelled');
  expect(state.approvals).toEqual([]);
});

test('a resumed conversation is rebuilt with each call settled by its result', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Summary of the earlier conversation:\nstuff', timestamp: 0 },
    { role: 'user', content: 'fix it', timestamp: 0 },
    { role: 'assistant', content: 'Looking.', timestamp: 0, tool_calls: [{ id: 'c1', function: { name: 'run_command', arguments: '{"command":"npm test"}' } }, { id: 'c2', function: { name: 'read_file', arguments: { path: 'b.txt' } } }] },
    { role: 'tool', content: '1 failing', timestamp: 0, tool_call_id: 'c1', toolName: 'run_command', toolStatus: 'error' },
    { role: 'tool', content: 'contents', timestamp: 0, tool_call_id: 'c2', toolName: 'read_file' },
    { role: 'assistant', content: 'Done.', timestamp: 0 },
  ];
  const state = run([{ type: 'submit', text: 'old' }, { type: 'load', messages }]);
  expect(kinds(state)).toEqual(['notice', 'user', 'assistant', 'tool', 'tool', 'assistant']);
  expect(tool(state, 'c1')).toMatchObject({ summary: 'run_command npm test', phase: 'error', output: '1 failing' });
  expect(tool(state, 'c2')).toMatchObject({ summary: 'read_file b.txt', phase: 'ok' });
  expect(state.running).toBe(false);
});

test('a block toggles open, output keeps only its tail, and clear empties the transcript', () => {
  let state = run([event({ type: 'tool_call', call: call('c5') })]);
  const id = tool(state, 'c5').id;
  state = reduceView(state, { type: 'toggle', id });
  expect(tool(state, 'c5').collapsed).toBe(false);
  const long = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n');
  expect(tail(long).split('\n')).toHaveLength(OUTPUT_TAIL_LINES);
  expect(tail(long).endsWith('line 99')).toBe(true);
  expect(tail('x'.repeat(10_000))).toHaveLength(4_000);
  const done = reduceView(state, event({ type: 'tool_result', result: { tool: 'read_file', success: true, output: long, durationMs: 1, callId: 'c5' } }));
  expect(tool(done, 'c5').output).toBe(tail(long));
  expect(reduceView(state, { type: 'clear' }).rows).toEqual([]);
});

test('reducing never changes the state it was given', () => {
  const streaming = run([event({ type: 'text', delta: 'a' })]);
  const streamingBefore = JSON.stringify(streaming);
  run([event({ type: 'text', delta: 'b' }), event({ type: 'reasoning', delta: 'c' })], streaming);
  expect(JSON.stringify(streaming)).toBe(streamingBefore);
  const before = run([event({ type: 'text', delta: 'a' }), event({ type: 'tool_call', call: call('c6') })]);
  const frozen = JSON.stringify(before);
  run([event({ type: 'text', delta: 'b' }), event({ type: 'tool_result', result: { tool: 'read_file', success: true, output: 'x', durationMs: 1, callId: 'c6' } }), { type: 'toggle', id: 2 }], before);
  expect(JSON.stringify(before)).toBe(frozen);
});

test('an edit keeps its proposed diff, then the one it made, shown open, with the file it names', () => {
  const edit = call('e1', 'edit', { path: 'src/a.ts', find_string: 'x', replace_string: 'y' });
  let state = run([
    event({ type: 'tool_call', call: edit }),
    event({ type: 'approval_request', call: edit, decide: () => undefined, request: { id: 'e1', call: edit, policyClass: 'write', summary: 'edit src/a.ts', preview: { kind: 'diff', text: 'proposed' }, reason: 'r', suggestions: [] } }),
  ]);
  expect(tool(state, 'e1')).toMatchObject({ diff: 'proposed', path: 'src/a.ts', collapsed: true });
  state = reduceView(state, event({ type: 'tool_result', result: { tool: 'edit', success: true, output: 'Replaced 1 occurrence.', durationMs: 2, callId: 'e1', status: 'ok', metadata: { diff: 'made' } } }));
  expect(tool(state, 'e1')).toMatchObject({ diff: 'made', collapsed: false, output: 'Replaced 1 occurrence.' });
  // A call with no diff stays closed.
  state = reduceView(state, event({ type: 'tool_call', call: call('r1') }));
  state = reduceView(state, event({ type: 'tool_result', result: { tool: 'read_file', success: true, output: 'x', durationMs: 1, callId: 'r1', metadata: {} } }));
  expect(tool(state, 'r1')).toMatchObject({ collapsed: true });
  expect(tool(state, 'r1').diff).toBeUndefined();
});
