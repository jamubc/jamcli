import { test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import { AcpServer } from '../server.js';
import type { AcpSessionController } from '../session.js';
import type { AgentEvent, RunResult } from '../../core/types.js';
import { readDecision } from '../../core/types.js';

const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

const approvableController = (): AcpSessionController => ({
  id: 'session-1',
  cwd: '/tmp/project',
  model: 'test-model',
  profile: 'default',
  configOptions: [{ id: 'model', name: 'Model', category: 'model', currentValue: 'test-model' }],
  async run(_prompt: string, onEvent: (event: AgentEvent) => void): Promise<RunResult> {
    onEvent({ type: 'text', delta: 'hello ' });
    onEvent({ type: 'tool_call', call: { id: 'call-1', name: 'write_file', arguments: { path: 'a.txt' } } });
    const approved = await new Promise<boolean>((resolve) =>
      onEvent({
        type: 'approval_request',
        call: { id: 'call-1', name: 'write_file', arguments: { path: 'a.txt' } },
        decide: (decision) => resolve(readDecision(decision).allow),
      })
    );
    if (!approved) {
      return { status: 'refused', sessionId: 'session-1', response: '', turns: 1, usage };
    }
    onEvent({ type: 'tool_result', result: { tool: 'write_file', callId: 'call-1', success: true, output: 'ok', durationMs: 1 } });
    onEvent({ type: 'text', delta: 'world' });
    return { status: 'ok', sessionId: 'session-1', response: 'hello world', turns: 1, usage };
  },
  cancel() {
    // The approvable controller finishes on permission, so nothing to do here.
  },
});

const cancellableController = (): AcpSessionController => {
  let finish: ((result: RunResult) => void) | null = null;
  let cancelled = false;
  return {
    id: 'session-2',
    cwd: '/tmp/project',
    model: 'test-model',
    profile: 'default',
    configOptions: [],
    run(_prompt: string, onEvent: (event: AgentEvent) => void): Promise<RunResult> {
      onEvent({ type: 'text', delta: 'working' });
      return new Promise<RunResult>((resolve) => {
        if (cancelled) {
          resolve({ status: 'cancelled', sessionId: 'session-2', response: '', turns: 0, usage });
          return;
        }
        finish = resolve;
      });
    },
    cancel() {
      cancelled = true;
      finish?.({ status: 'cancelled', sessionId: 'session-2', response: '', turns: 0, usage });
    },
  };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error('condition not met in time');
};

const collect = (stream: PassThrough): any[] => {
  const messages: any[] = [];
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) messages.push(JSON.parse(line));
    }
  });
  return messages;
};

test('the ACP server initializes, opens a session, and streams a prompt with a permission round trip', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = collect(output);
  const server = new AcpServer({
    input,
    output,
    projectRoot: '/tmp/project',
    createSession: async () => approvableController(),
  });
  void server.start();
  const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
  send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
  await waitFor(() => messages.some((message) => message.id === 2 && message.result));
  send({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 'session-1', prompt: [{ type: 'text', text: 'go' }] } });

  await waitFor(() => messages.some((message) => message.method === 'session/request_permission'));
  const permission = messages.find((message) => message.method === 'session/request_permission');
  expect(permission.params.toolCall.toolCallId).toBe('call-1');
  expect(permission.params.options).toHaveLength(4);
  send({ jsonrpc: '2.0', id: permission.id, result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } });

  await waitFor(() => messages.some((message) => message.id === 3 && message.result));
  input.end();

  const initialize = messages.find((message) => message.id === 1);
  expect(initialize.result.protocolVersion).toBe(1);
  expect(initialize.result.agentInfo).toEqual({ name: 'jamcli', version: '1.0.0' });

  const newSession = messages.find((message) => message.id === 2);
  expect(newSession.result.sessionId).toBe('session-1');
  expect(newSession.result.configOptions[0]).toMatchObject({ id: 'model', currentValue: 'test-model' });

  const updates = messages.filter((message) => message.method === 'session/update').map((message) => message.params.update);
  expect(updates.map((update) => update.sessionUpdate)).toEqual([
    'agent_message_chunk',
    'tool_call',
    'tool_call_update',
    'agent_message_chunk',
  ]);
  expect(updates[0].content.text).toBe('hello ');
  expect(updates[1]).toMatchObject({ sessionUpdate: 'tool_call', toolCallId: 'call-1' });
  expect(updates[2]).toMatchObject({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' });
  expect(updates[3].content.text).toBe('world');

  expect(messages.find((message) => message.id === 3).result.stopReason).toBe('end_turn');
});

test('a rejected permission turns the prompt into a refusal and no tool result is emitted', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = collect(output);
  const server = new AcpServer({
    input,
    output,
    projectRoot: '/tmp/project',
    createSession: async () => approvableController(),
  });
  void server.start();
  const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);

  send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
  await waitFor(() => messages.some((message) => message.id === 1 && message.result));
  send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'session-1', prompt: [{ type: 'text', text: 'go' }] } });

  await waitFor(() => messages.some((message) => message.method === 'session/request_permission'));
  const permission = messages.find((message) => message.method === 'session/request_permission');
  send({ jsonrpc: '2.0', id: permission.id, result: { outcome: { outcome: 'selected', optionId: 'reject-once' } } });

  await waitFor(() => messages.some((message) => message.id === 2 && message.result));
  input.end();

  const updates = messages.filter((message) => message.method === 'session/update').map((message) => message.params.update);
  expect(updates.map((update) => update.sessionUpdate)).toEqual(['agent_message_chunk', 'tool_call']);
  expect(messages.find((message) => message.id === 2).result.stopReason).toBe('refusal');
});

test('session/cancel stops the in-flight turn and reports cancelled', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = collect(output);
  const server = new AcpServer({
    input,
    output,
    projectRoot: '/tmp/project',
    createSession: async () => cancellableController(),
  });
  void server.start();
  const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);

  send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
  await waitFor(() => messages.some((message) => message.id === 1 && message.result));
  send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'session-2', prompt: [{ type: 'text', text: 'go' }] } });
  await waitFor(() => messages.some((message) => message.method === 'session/update'));

  send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'session-2' } });
  await waitFor(() => messages.some((message) => message.id === 2 && message.result));
  input.end();

  expect(messages.find((message) => message.id === 2).result.stopReason).toBe('cancelled');
});

test('an unknown session is reported as a JSON-RPC error', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = collect(output);
  const server = new AcpServer({ input, output, projectRoot: '/tmp/project', createSession: async () => approvableController() });
  void server.start();

  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'session/prompt', params: { sessionId: 'missing', prompt: [] } })}\n`);
  await waitFor(() => messages.some((message) => message.id === 5));
  input.end();

  const error = messages.find((message) => message.id === 5);
  expect(error.error.code).toBe(-32001);
});

test('sessions are closed when the client disconnects', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = collect(output);
  let closed = 0;
  const server = new AcpServer({
    input,
    output,
    projectRoot: '/tmp/project',
    createSession: async () => ({ ...approvableController(), close: async () => void (closed += 1) }),
  });
  const done = server.start();
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } })}\n`);
  await waitFor(() => messages.some((message) => message.id === 1));
  input.end();
  await done;
  expect(closed).toBe(1);
});
