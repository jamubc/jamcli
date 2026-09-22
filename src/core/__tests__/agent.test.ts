import { test, expect } from 'bun:test';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
import type { ChatProvider, StreamChunk } from '../providers/types.js';
import type { AgentEvent } from '../types.js';

test('the loop skeleton runs a turn and emits a text event', async () => {
  const agent = new CoreAgent();
  const session = createSession('/tmp/test-project');
  const events: AgentEvent[] = [];
  const result = await agent.run(session, 'hello', (e) => events.push(e));
  expect(result.status).toBe('ok');
  expect(result.sessionId).toBe(session.id);
  expect(result.turns).toBe(1);
  expect(result.response).toBe('hello');
  expect(events).toEqual([{ type: 'text', delta: 'hello' }]);
});

test('the core streams a provider reply with reasoning and usage', async () => {
  const chunks: StreamChunk[] = [
    { content: 'hel', done: false },
    { content: 'lo', done: false, reasoning: 'greet' },
    {
      content: '',
      done: true,
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    },
  ];
  const provider: ChatProvider = {
    async *streamChat() {
      yield* chunks;
    },
  };
  const agent = new CoreAgent({ provider, model: 'test-model', modelUsageKey: 'test:test-model' });
  const session = createSession('/tmp/test-project');
  const events: AgentEvent[] = [];
  const result = await agent.run(session, 'hello', (e) => events.push(e));
  expect(result.status).toBe('ok');
  expect(result.response).toBe('hello');
  expect(result.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  expect(events).toEqual([
    { type: 'text', delta: 'hel' },
    { type: 'text', delta: 'lo' },
    { type: 'reasoning', delta: 'greet' },
    { type: 'usage', usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
  ]);
});
test('cancel stops a queued run and leaves the session usable', async () => {
  const agent = new CoreAgent();
  const session = createSession('/tmp/test-project');
  agent.cancel(session.id);
  const events: AgentEvent[] = [];
  const cancelled = await agent.run(session, 'hello', (e) => events.push(e));
  expect(cancelled.status).toBe('cancelled');
  expect(events).toEqual([]);
  const again = await agent.run(session, 'hello', (e) => events.push(e));
  expect(again.status).toBe('ok');
});
