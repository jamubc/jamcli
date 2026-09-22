import { test, expect } from 'bun:test';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
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
