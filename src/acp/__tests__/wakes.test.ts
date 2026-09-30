import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { AcpServer } from '../server.js';
import type { AcpSessionController } from '../session.js';
import type { AgentEvent, RunResult } from '../../core/types.js';
import type { FiredWake } from '../../core/wake/index.js';

const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

test('a wake that goes off during a prompt runs as its own turn once the prompt ends, streamed to the editor', async () => {
  let wake: ((fired: FiredWake) => void) | undefined;
  let release: (() => void) | undefined;
  let running = 0;
  const ran: string[] = [];
  const controller: AcpSessionController = {
    id: 'session-1',
    cwd: '/tmp/project',
    model: 'test-model',
    profile: 'default',
    configOptions: [],
    async run(prompt: string, onEvent: (event: AgentEvent) => void): Promise<RunResult> {
      running += 1;
      // Two turns never overlap in one session.
      expect(running).toBe(1);
      ran.push(prompt);
      if (prompt === 'go') await new Promise<void>((resolve) => (release = resolve));
      onEvent({ type: 'text', delta: prompt === 'go' ? 'prompted' : 'woke' });
      running -= 1;
      return { status: 'ok', sessionId: 'session-1', response: '', turns: 1, usage };
    },
    cancel() {},
    onWake: (listener) => {
      wake = listener;
      return () => (wake = undefined);
    },
  };
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: any[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) messages.push(JSON.parse(line));
  });
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('condition not met in time');
      await Bun.sleep(5);
    }
  };
  void new AcpServer({ input, output, projectRoot: '/tmp/project', createSession: async () => controller }).start();
  const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
  send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/project', mcpServers: [] } });
  await waitFor(() => messages.some((message) => message.id === 2 && message.result));
  send({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 'session-1', prompt: [{ type: 'text', text: 'go' }] } });
  await waitFor(() => release !== undefined);

  wake!({ id: 'w1', prompt: 'check the deploy', at: 0, by: 'model', setAt: 0, text: '[Wake w1 went off: its timer ran out.]\n\ncheck the deploy', display: '⏰ w1 · check the deploy' });
  await Bun.sleep(50);
  expect(ran).toEqual(['go']);
  release!();

  await waitFor(() => ran.length === 2 && messages.filter((message) => message.method === 'session/update').length === 3);
  expect(ran[1]).toStartWith('[Wake w1 went off');
  const updates = messages.filter((message) => message.method === 'session/update').map((message) => [message.params.update.sessionUpdate, message.params.update.content.text]);
  expect(updates).toEqual([
    ['agent_message_chunk', 'prompted'],
    ['user_message_chunk', '⏰ w1 · check the deploy'],
    ['agent_message_chunk', 'woke'],
  ]);
  input.end();
});
